import EventEmitter from 'node:events';
import amqp from 'amqplib';
import { logger } from '../logger';
import { retryUntil } from '../utility/backoff';
import { toError } from '../utility/error';
import { requireEnv } from './env';
import { connectionRegistry } from './registry';

export type Connection = amqp.Connection;
export type Channel = amqp.Channel;

/**
 * rabbitmq.ts and mongo.ts intentionally mirror each other — same member order,
 * same lifecycle (single-flight connect, retry with backoff, reconnect on abrupt
 * close, graceful close on shutdown). To add a new managed connection type,
 * copy one of them and swap the driver calls.
 */
export class RabbitConnection extends EventEmitter {
    private gracefulClose = false;
    private connectionString: string;
    private connection?: Connection;
    private connectPromise?: Promise<void>;

    constructor(connectionString: string) {
        super();
        if (!connectionString) throw new Error('connectionString is required');
        this.connectionString = connectionString;
    }

    public status(): boolean {
        return !!this.connection;
    }

    public connect(): Promise<void> {
        this.connectPromise ??= this.setupConnection();
        return this.connectPromise;
    }

    public getConnection(): Connection | undefined {
        return this.connection;
    }

    private async setupConnection(): Promise<void> {
        const connection = await retryUntil(
            async (): Promise<Connection | undefined> => {
                try {
                    return await amqp.connect(this.connectionString);
                } catch (error) {
                    logger.warn('[Rabbit] Connect failed', { err: toError(error) });
                    return undefined;
                }
            },
            { label: 'rabbitmq-connect', shouldStop: () => this.gracefulClose },
        );
        if (!connection) return;
        this.connection = connection;
        this.initEventListeners();
    }

    private initEventListeners(): void {
        if (!this.connection) return;
        logger.info('[Rabbit] Connection established');
        this.emit('connect', this.connection);

        this.connection.on('error', (error) => logger.error('[Rabbit] Connection error', { err: toError(error) }));
        this.connection.on('close', () => {
            this.connection?.removeAllListeners();
            this.connection = undefined;
            if (this.gracefulClose) {
                logger.info('[Rabbit] Connection closed gracefully');
                this.emit('gracefulClose');
                return;
            }
            logger.error('[Rabbit] Connection closed abruptly; reconnecting');
            this.setupConnection();
        });
    }

    public async closeConnection(): Promise<void> {
        this.gracefulClose = true;
        if (this.connection) {
            logger.info('[Rabbit] Closing connection...');
            await this.connection.close();
        }
    }
}

const registry = connectionRegistry('rabbitmq', (connectionString) => new RabbitConnection(connectionString));

export const rabbitStatus = registry.status;

export function getRabbit(connectionString?: string): RabbitConnection {
    return registry.get(connectionString ?? requireEnv('QUEUE_CONNECTION_URL'));
}
