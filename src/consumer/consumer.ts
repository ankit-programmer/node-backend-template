import EventEmitter from 'node:events';
import type { Channel, Connection, ConsumeMessage } from 'amqplib';
import { getRabbit } from '../config/rabbitmq';
import { logger } from '../logger';
import { buildQueueOptions, type Metadata } from '../utility/amqp';
import { retryUntil } from '../utility/backoff';
import { decompress } from '../utility/compression';
import { toError } from '../utility/error';

export type { Metadata };

const DEFAULT_AGGREGATE_TIMEOUT_SEC = 30;
const EMPTY_QUEUE_STATUS = { messageCount: 0, consumerCount: 0 };

interface IConsumerBase {
    queue: string;
    clean?: () => void;
    batch: number;
    metadata?: Metadata;
}

interface IConsumerAggregated extends IConsumerBase {
    aggregate: {
        enabled: true;
        timeout?: number;
    };
    /** Owns message acknowledgement: ack/nack every message, the framework never does it for you. */
    processor: (messages: ConsumeMessage[], channel: Channel) => unknown;
}

interface IConsumerSingle extends IConsumerBase {
    aggregate?: {
        enabled?: false;
        timeout?: number;
    };
    /** Owns message acknowledgement: ack/nack every message, the framework never does it for you. */
    processor: (message: ConsumeMessage, channel: Channel) => unknown;
}

export type IConsumer = IConsumerAggregated | IConsumerSingle;

export class Batch<T = unknown> extends EventEmitter {
    private size: number;
    private timeout: number | undefined;
    private queue: T[];
    private timeoutRef?: NodeJS.Timeout = undefined;

    constructor(size: number, timeoutInSec?: number) {
        super();
        this.size = size;
        this.timeout = timeoutInSec;
        this.queue = [];
    }

    public push(message: T): void {
        this.queue.push(message);
        if (this.queue.length >= this.size) {
            if (this.timeoutRef) clearTimeout(this.timeoutRef);
            this.emit('process', this.queue.splice(0, this.size));
        }
        if (!this.timeout) return;
        if (this.queue.length === 1) {
            if (this.timeoutRef) clearTimeout(this.timeoutRef);
            this.timeoutRef = setTimeout(() => {
                const batch = this.queue.splice(0, this.size);
                if (batch.length) this.emit('process', batch);
            }, this.timeout * 1000);
        }
    }

    public clear(): void {
        this.queue = [];
        if (this.timeoutRef) clearTimeout(this.timeoutRef);
    }
}

export class Consumer {
    private connection?: Connection;
    private channel?: Channel;
    private tag?: string;
    private queue: string;
    private processor: IConsumer['processor'];
    private clean?: () => void;
    private bufferSize: number = 1;
    private rabbitService: ReturnType<typeof getRabbit>;
    private aggregate: boolean = false;
    private shutdown = false;
    private metadata?: Metadata;
    private initPromise?: Promise<void>;
    private batch: Batch<ConsumeMessage>;

    constructor(obj: IConsumer, connectionString?: string) {
        this.queue = obj.queue;
        this.processor = obj.processor;
        this.bufferSize = obj.batch;
        this.clean = obj.clean;
        this.metadata = obj.metadata;
        // Aggregated consumers always flush on a timer so sub-batch messages never sit unacked.
        this.aggregate = obj.aggregate?.enabled || false;
        const batchSize = this.aggregate ? this.bufferSize : 1;
        const batchTimeout = this.aggregate ? (obj.aggregate?.timeout ?? DEFAULT_AGGREGATE_TIMEOUT_SEC) : undefined;
        this.batch = new Batch<ConsumeMessage>(batchSize, batchTimeout);
        // Setup the consumer
        this.rabbitService = getRabbit(connectionString);
        this.rabbitService.on('connect', () => this.init());
        this.init();
    }

    private init(): Promise<void> {
        this.initPromise ??= this.setup().finally(() => {
            this.initPromise = undefined;
        });
        return this.initPromise;
    }

    private async setup(): Promise<void> {
        this.channel?.removeAllListeners();
        await this.channel?.close().catch(() => undefined);
        this.channel = undefined;
        this.connection = undefined;
        const channel = await retryUntil(
            async () => {
                this.connection = this.rabbitService.getConnection();
                if (!this.connection) return undefined;
                return this.connection.createChannel().catch((error) => {
                    logger.error('[Consumer] Failed to create channel', { err: toError(error) });
                    return undefined;
                });
            },
            { label: `consumer-channel(${this.queue})`, shouldStop: () => this.shutdown },
        );
        if (!channel) return;
        this.channel = channel;
        channel.once('error', () => this.init());
        channel.once('close', () => this.init());
        this.batch.removeAllListeners();
        this.batch.clear();
        await this.start(channel).catch((error) => {
            logger.error(`[Consumer] Failed to start consuming ${this.queue}`, { err: toError(error) });
        });
        logger.info(`[Consumer] Consuming queue ${this.queue}`);
    }

    private async start(channel: Channel) {
        await channel.prefetch(this.bufferSize);
        if (!this.metadata?.skipAssert) await channel.assertQueue(this.queue, buildQueueOptions(this.metadata));
        const exchange = this.metadata?.exchange;
        if (exchange) {
            await channel.assertExchange(exchange.name, exchange.type || 'direct', { durable: true });
            await channel.bindQueue(this.queue, exchange.name, exchange.routingKey || 'default');
        }
        this.batch.on('process', async (messages: ConsumeMessage[]) => {
            if (this.shutdown) {
                logger.info('[Consumer] Shutting down, no longer processing messages');
                return;
            }
            try {
                this.aggregate
                    ? await (this.processor as IConsumerAggregated['processor'])(messages, channel)
                    : await (this.processor as IConsumerSingle['processor'])(messages[0], channel);
            } catch (error) {
                logger.error(`[Consumer] Processor for ${this.queue} threw`, { err: toError(error) });
            }
        });
        const response = await channel.consume(
            this.queue,
            async (message: ConsumeMessage | null) => {
                if (!message) return;
                if (message.properties.contentEncoding) {
                    let content: string;
                    try {
                        content = await decompress(message.content, message.properties.contentEncoding);
                    } catch (error) {
                        // Undecodable messages are rejected here and never reach the processor —
                        // the ack-ownership contract applies to decoded messages only. nack without
                        // requeue dead-letters the message when the queue is configured for it.
                        logger.error(`[Consumer] Failed to decompress message from ${this.queue}`, {
                            err: toError(error),
                        });
                        channel.nack(message, false, false);
                        return;
                    }
                    message.content = Buffer.from(content);
                }
                this.batch.push(message);
            },
            { noAck: false },
        );
        this.tag = response.consumerTag;
    }

    public async stop(): Promise<void> {
        this.shutdown = true;
        this.channel?.removeAllListeners();
        if (this.tag) await this.channel?.cancel(this.tag).catch(() => undefined);
        await this.channel?.close().catch(() => undefined);
        this.clean?.();
    }

    public async queueStatus(): Promise<{ messageCount: number; consumerCount: number }> {
        if (!this.channel) return EMPTY_QUEUE_STATUS;
        return this.channel.assertQueue(this.queue, buildQueueOptions(this.metadata)).catch(() => EMPTY_QUEUE_STATUS);
    }
}
