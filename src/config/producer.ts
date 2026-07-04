import type { ConfirmChannel } from 'amqplib';
import { logger } from '../logger';
import { buildQueueOptions, type Metadata } from '../utility/amqp';
import { retryUntil } from '../utility/backoff';
import { type Compressor, compress } from '../utility/compression';
import { toError } from '../utility/error';
import { getRabbit, type RabbitConnection } from './rabbitmq';

interface ExchangeOptions {
    replyTo?: string;
    correlationId?: string;
    routingKey?: string;
    timestamp?: number;
    persistent?: boolean;
    compressor?: Compressor;
}

const PUBLISH_RETRY = { baseMs: 2000, maxMs: 30_000, maxAttempts: 5 };

class RabbitMqProducer {
    private rabbitService: RabbitConnection;
    private rabbitChannel?: ConfirmChannel;
    private initPromise?: Promise<void>;

    constructor(connectionString?: string) {
        this.rabbitService = getRabbit(connectionString);
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
                    logger.error('[Producer] Failed to create channel', { err: toError(error) });
                    return undefined;
                });
            },
            { label: 'producer-channel' },
        );
        if (!channel) return;
        this.rabbitChannel = channel;
        channel.once('error', () => this.init());
        channel.once('close', () => this.init());
        logger.info('[Producer] Channel created');
    }

    public async isExchangeAvailable(name: string): Promise<boolean> {
        if (!this.rabbitChannel) return false;
        return this.rabbitChannel
            .checkExchange(name)
            .then(() => true)
            .catch(() => false);
    }

    public async publish(exchange: string, content: unknown, options: ExchangeOptions): Promise<boolean> {
        const routingKey = options.routingKey || 'default';
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        const payload = options.compressor ? await compress(text, options.compressor) : Buffer.from(text);
        const published = await retryUntil(
            async () => (await this.confirm(exchange, routingKey, payload, options)) || undefined,
            { label: `publish(${exchange})`, ...PUBLISH_RETRY },
        );
        if (!published) logger.error(`[Producer] Failed to publish to exchange ${exchange}`);
        return !!published;
    }

    public async publishToQueue(queueName: string, content: unknown, metadata?: Metadata): Promise<boolean> {
        const text = typeof content === 'string' ? content : JSON.stringify(content);
        const payload = metadata?.compressor ? await compress(text, metadata.compressor) : Buffer.from(text);
        if (!metadata?.skipAssert && this.rabbitChannel) {
            // A failed assert also closes the channel, so publishing after it can only fail.
            const asserted = await this.rabbitChannel
                .assertQueue(queueName, buildQueueOptions(metadata))
                .then(() => true)
                .catch((error) => {
                    logger.error(`[Producer] Failed to assert queue ${queueName}`, { err: toError(error) });
                    return false;
                });
            if (!asserted) return false;
        }
        const published = await retryUntil(
            async () => (await this.confirmToQueue(queueName, payload, metadata)) || undefined,
            { label: `publishToQueue(${queueName})`, ...PUBLISH_RETRY },
        );
        if (!published) logger.error(`[Producer] Failed to publish to queue ${queueName}`);
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

const instances = new Map<string, RabbitMqProducer>();

export const Producer = (connectionString?: string): RabbitMqProducer => {
    const key = connectionString || 'default';
    let producer = instances.get(key);
    if (!producer) {
        producer = new RabbitMqProducer(connectionString);
        instances.set(key, producer);
    }
    return producer;
};
