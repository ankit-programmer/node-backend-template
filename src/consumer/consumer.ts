import type { Channel, Connection, ConsumeMessage } from 'amqplib';
import EventEmitter from 'events';
import rabbitmq from '../config/rabbitmq';
import logger from '../logger';
import { delay } from '../utility';
import { type compressor, decompress } from '../utility/compression';

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
    processor: (messages: ConsumeMessage[], channel: Channel) => any;
}

interface IConsumerSingle extends IConsumerBase {
    aggregate?: {
        enabled?: false;
        timeout?: number;
    };
    processor: (message: ConsumeMessage, channel: Channel) => any;
}

export type IConsumer = IConsumerAggregated | IConsumerSingle;

export interface Metadata {
    exchange?: {
        name: string;
        type?: 'direct' | 'topic' | 'fanout';
        routingKey?: string;
    };
    compressor?: compressor;
    correlationId?: string;
    replyTo?: string;
    exclusive?: boolean;
    skipAssert?: boolean;
    messageTtl?: number;
    deadLetterExchange?: string;
    deadLetterRoutingKey?: string;
    persistent?: boolean;
    timestamp?: number; // Timestamp in second i.e Math.floor(Date.now()/1000)
}

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
    private initializing: boolean = false;
    private batch: Batch;

    constructor(obj: IConsumer, connectionString?: string) {
        this.queue = obj.queue;
        this.processor = obj.processor;
        this.bufferSize = obj.batch;
        this.clean = obj.clean;
        this.metadata = obj.metadata;
        // Setup aggregation
        this.aggregate = obj.aggregate?.enabled || false;
        const batchSize = this.aggregate ? this.bufferSize : 1; // Only batch if aggregation is enabled
        this.batch = new Batch(batchSize, obj.aggregate?.timeout);
        // Setup the consumer
        this.rabbitService = rabbitmq(connectionString);
        this.rabbitService.on('connect', () => this.init());
        this.rabbitService.on('error', () => this.init());
        this.init();
    }

    private async init() {
        if (this.initializing) return;
        logger.info('Initializing');
        this.initializing = true;
        this.channel?.removeAllListeners();
        await this.channel?.close().catch(() => undefined);
        this.channel = undefined;
        this.connection = undefined;
        let channel: Channel | undefined;
        let retry = 0;
        while (!channel) {
            this.connection = this.rabbitService.getConnection();
            channel = await this.connection?.createChannel().catch((err) => {
                logger.error('[Consumer] Failed to create channel', { error: err.message });
                return undefined;
            });
            if (channel) break;
            retry = Math.min(++retry, 30);
            logger.info('[Consumer] Waiting for channel');
            await delay(1000 * retry);
        }
        this.channel = channel;
        channel.once('error', () => this.init());
        channel.once('close', () => this.init());
        this.batch.removeAllListeners();
        this.batch.clear();
        this.start(channel).catch(() => undefined);
        this.initializing = false;
        logger.info('Initialized');
    }

    private async start(channel: Channel) {
        await this.channel?.prefetch(this.bufferSize);
        const options: any = { durable: true };
        if (this.metadata?.exclusive) options.exclusive = this.metadata.exclusive;
        if (this.metadata?.messageTtl) options.messageTtl = this.metadata.messageTtl;
        if (this.metadata?.deadLetterExchange) options.deadLetterExchange = this.metadata.deadLetterExchange;
        if (this.metadata?.deadLetterRoutingKey) options.deadLetterRoutingKey = this.metadata.deadLetterRoutingKey;
        if (!this.metadata?.skipAssert) await channel?.assertQueue(this.queue, options).catch(() => undefined);
        const exchange = this.metadata?.exchange;
        if (exchange) {
            await channel
                ?.assertExchange(exchange.name, exchange.type || 'direct', { durable: true })
                .catch(() => undefined);
            await channel
                ?.bindQueue(this.queue, exchange.name, exchange.routingKey || 'default')
                .catch(() => undefined);
        }
        this.batch.on('process', async (messages: any[]) => {
            if (this.shutdown) {
                logger.info('This consumer is shutting down, no longer processing messages');
                return;
            }
            try {
                this.aggregate
                    ? await this.processor(messages as any, channel!)
                    : await this.processor(messages[0], channel!);
            } catch (error: any) {
                logger.error(error);
                throw error;
            }
        });
        // Start consuming messages
        const response = await channel
            ?.consume(
                this.queue,
                async (message: ConsumeMessage | null) => {
                    if (message?.properties.contentEncoding) {
                        const content = await decompress(message?.content!, message.properties.contentEncoding).catch(
                            () => '{"error":"Failed to decompress message"}',
                        );
                        message!.content = Buffer.from(content);
                    }
                    this.batch.push(message);
                },
                { noAck: false },
            )
            .catch(() => undefined);
        this.tag = response?.consumerTag;
    }

    public async stop() {
        this.shutdown = true;
        this.channel?.removeAllListeners();
        if (this.tag) await this.channel?.cancel(this.tag).catch(() => undefined);
        await this.channel?.close().catch(() => undefined);
        this.clean?.();
    }

    public async queueStatus() {
        let status = { messageCount: 0, consumerCount: 0 };
        if (this.channel) {
            const options: any = { durable: true };
            if (this.metadata && this.metadata.exclusive) options.exclusive = this.metadata.exclusive;
            const queue = await this.channel.assertQueue(this.queue, options).catch(() => {
                return { messageCount: 0, consumerCount: 0 };
            });
            status = queue;
        }
        return status;
    }
}
