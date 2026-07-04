import EventEmitter from 'node:events';
import type { Channel, Connection, ConsumeMessage } from 'amqplib';
import rabbitmq from '../config/rabbitmq';
import logger from '../logger';
import { buildQueueOptions, type Metadata } from '../utility/amqp';
import { retryUntil } from '../utility/backoff';
import { decompress } from '../utility/compression';

export type { Metadata };

const DEFAULT_AGGREGATE_TIMEOUT_SEC = 30;

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
    processor: (messages: ConsumeMessage[], channel: Channel) => any;
}

interface IConsumerSingle extends IConsumerBase {
    aggregate?: {
        enabled?: false;
        timeout?: number;
    };
    /** Owns message acknowledgement: ack/nack every message, the framework never does it for you. */
    processor: (message: ConsumeMessage, channel: Channel) => any;
}

export type IConsumer = IConsumerAggregated | IConsumerSingle;

export class Batch extends EventEmitter {
    private size: number;
    private timeout: number | undefined;
    private queue: Array<any>;
    private timeoutRef?: NodeJS.Timeout = undefined;

    constructor(size: number, timeoutInSec?: number) {
        super();
        this.size = size;
        this.timeout = timeoutInSec;
        this.queue = [];
    }

    public push(message: any) {
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

    public clear() {
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
    private rabbitService;
    private aggregate: boolean = false;
    private shutdown = false;
    private metadata?: Metadata;
    private initPromise?: Promise<void>;
    private batch: Batch;

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
        this.batch = new Batch(batchSize, batchTimeout);
        // Setup the consumer
        this.rabbitService = rabbitmq(connectionString);
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
                    logger.error('[Consumer] Failed to create channel', { error: error.message });
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
            logger.error(`[Consumer] Failed to start consuming ${this.queue}`, error);
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
        this.batch.on('process', async (messages: any[]) => {
            if (this.shutdown) {
                logger.info('[Consumer] Shutting down, no longer processing messages');
                return;
            }
            try {
                this.aggregate
                    ? await this.processor(messages as any, channel)
                    : await this.processor(messages[0], channel);
            } catch (error: any) {
                logger.error(`[Consumer] Processor for ${this.queue} threw`, error);
            }
        });
        const response = await channel.consume(
            this.queue,
            async (message: ConsumeMessage | null) => {
                if (!message) return;
                if (message.properties.contentEncoding) {
                    const content = await decompress(message.content, message.properties.contentEncoding).catch(
                        () => '{"error":"Failed to decompress message"}',
                    );
                    message.content = Buffer.from(content);
                }
                this.batch.push(message);
            },
            { noAck: false },
        );
        this.tag = response.consumerTag;
    }

    public async stop() {
        this.shutdown = true;
        this.channel?.removeAllListeners();
        if (this.tag) await this.channel?.cancel(this.tag).catch(() => undefined);
        await this.channel?.close().catch(() => undefined);
        this.clean?.();
    }

    public async queueStatus() {
        if (!this.channel) return { messageCount: 0, consumerCount: 0 };
        return this.channel.assertQueue(this.queue, buildQueueOptions(this.metadata)).catch(() => {
            return { messageCount: 0, consumerCount: 0 };
        });
    }
}
