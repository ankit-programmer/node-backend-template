import type { ConfirmChannel } from 'amqplib';
import logger from '../logger';
import { buildQueueOptions, type Metadata } from '../utility/amqp';
import { retryUntil } from '../utility/backoff';
import { compress, type compressor } from '../utility/compression';
import rabbitmqService, { type RabbitConnection } from './rabbitmq';

interface ExchangeOptions {
    replyTo?: string;
    correlationId?: string;
    routingKey?: string;
    timestamp?: number;
    persistent?: boolean;
    compressor?: compressor;
}

const PUBLISH_RETRY = { baseMs: 2000, maxMs: 30_000, maxAttempts: 5 };

class RabbitMqProducer {
    private rabbitService: RabbitConnection;
    private rabbitChannel?: ConfirmChannel;
    private initPromise?: Promise<void>;

    constructor(connectionString?: string) {
        this.rabbitService = rabbitmqService(connectionString);
        this.rabbitService.on('connect', () => this.init());
        this.init();
    }

    private init(): Promise<void> {
        this.initPromise ??= this.createChannel().finally(() => {
            this.initPromise = undefined;
        });
        return this.initPromise;
    }

    private async createChannel(): Promise<void> {
        this.rabbitChannel?.removeAllListeners();
        await this.rabbitChannel?.close().catch(() => undefined);
        this.rabbitChannel = undefined;
        const channel = await retryUntil(
            async () => {
                const connection = this.rabbitService.getConnection();
                if (!connection) return undefined;
                return connection.createConfirmChannel().catch((error) => {
                    logger.error('[RabbitMqProducer] Failed to create channel', { error: error.message });
                    return undefined;
                });
            },
            { label: 'producer-channel' },
        );
        if (!channel) return;
        this.rabbitChannel = channel;
        channel.once('error', () => this.init());
        channel.once('close', () => this.init());
        logger.info('[RabbitMqProducer] Channel created');
    }

    public async isExchangeAvailable(name: string): Promise<boolean> {
        if (!this.rabbitChannel) return false;
        return this.rabbitChannel
            .checkExchange(name)
            .then(() => true)
            .catch(() => false);
    }

    public async publish(exchange: string, content: any, options: ExchangeOptions): Promise<boolean> {
        const routingKey = options.routingKey || 'default';
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        const payload = options.compressor ? await compress(text, options.compressor) : Buffer.from(text);
        const published = await retryUntil(
            async () => (await this.confirm(exchange, routingKey, payload, options)) || undefined,
            { label: `publish(${exchange})`, ...PUBLISH_RETRY },
        );
        if (!published) logger.error(`[RabbitMqProducer] Failed to publish to exchange ${exchange}`);
        return !!published;
    }

    public async publishToQueue(queueName: string, content: any, metadata?: Metadata): Promise<boolean> {
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        const payload = metadata?.compressor ? await compress(text, metadata.compressor) : Buffer.from(text);
        if (!metadata?.skipAssert) {
            await this.rabbitChannel?.assertQueue(queueName, buildQueueOptions(metadata)).catch((error) => {
                logger.error(`[RabbitMqProducer] Failed to assert queue ${queueName}`, error);
            });
        }
        const published = await retryUntil(
            async () => (await this.confirmToQueue(queueName, payload, metadata)) || undefined,
            { label: `publishToQueue(${queueName})`, ...PUBLISH_RETRY },
        );
        if (!published) logger.error(`[RabbitMqProducer] Failed to publish to queue ${queueName}`);
        return !!published;
    }

    private confirm(exchange: string, routingKey: string, payload: Buffer, options: ExchangeOptions): Promise<boolean> {
        return new Promise((resolve) => {
            if (!this.rabbitChannel) return resolve(false);
            this.rabbitChannel.publish(
                exchange,
                routingKey,
                payload,
                { ...options, contentEncoding: options.compressor },
                (error) => resolve(!error),
            );
        });
    }

    private confirmToQueue(queueName: string, payload: Buffer, metadata?: Metadata): Promise<boolean> {
        return new Promise((resolve) => {
            if (!this.rabbitChannel) return resolve(false);
            const messageOptions = {
                correlationId: metadata?.correlationId,
                replyTo: metadata?.replyTo,
                timestamp: metadata?.timestamp,
                persistent: metadata?.persistent,
                contentEncoding: metadata?.compressor,
            };
            this.rabbitChannel.sendToQueue(queueName, payload, messageOptions, (error) => resolve(!error));
        });
    }
}

const instance = new Map<string, RabbitMqProducer>();
export const Producer = (connectionString?: string) => {
    const key = connectionString || 'default';
    if (!instance.has(key)) instance.set(key, new RabbitMqProducer(connectionString));
    return instance.get(key) as RabbitMqProducer;
};
