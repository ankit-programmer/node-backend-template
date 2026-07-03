import amqp from 'amqplib';
import EventEmitter from 'events';
import { onShutdown } from '../lifecycle/shutdown';
import logger from '../logger';
import { retryUntil } from '../utility/backoff';
import { requireEnv } from './env';

export type Connection = amqp.Connection;
export type Channel = amqp.Channel;

export class RabbitConnection extends EventEmitter {
    private gracefulClose: boolean = false;
    private connectionString: string;
    private connection?: Connection;
    private connectPromise?: Promise<void>;

    constructor(connectionString: string) {
        super();
        if (!connectionString) throw new Error('connectionString is required');
        this.connectionString = connectionString;
    }

    public status() {
        return !!this.connection;
    }

    public connect(): Promise<void> {
        this.connectPromise ??= this.setupConnection();
        return this.connectPromise;
    }

    private async setupConnection(): Promise<void> {
        const connection = await retryUntil(
            async (): Promise<Connection | undefined> => {
                try {
                    return await amqp.connect(this.connectionString);
                } catch (error: any) {
                    logger.warn(`[RABBIT] Connect failed: ${error.message}`);
                    return undefined;
                }
            },
            { label: 'rabbitmq-connect', shouldStop: () => this.gracefulClose },
        );
        if (!connection) return;
        this.connection = connection;
        this.initEventListeners();
    }

    private initEventListeners() {
        if (!this.connection) return;
        logger.info('[RABBIT] Connection established');
        this.emit('connect', this.connection);

        this.connection.on('error', (error) => logger.error('[RABBIT] Connection error', error));
        this.connection.on('close', () => {
            this.connection?.removeAllListeners();
            this.connection = undefined;
            if (this.gracefulClose) {
                logger.info('[RABBIT] Connection closed gracefully');
                this.emit('gracefulClose');
                return;
            }
            logger.error('[RABBIT] Connection closed abruptly; reconnecting');
            this.setupConnection();
        });
    }

    public async closeConnection(): Promise<void> {
        this.gracefulClose = true;
        if (this.connection) {
            logger.info('[RABBIT] Closing connection...');
            await this.connection.close();
        }
    }

    public getConnection(): Connection | undefined {
        return this.connection;
    }
}

const instances = new Map<string, RabbitConnection>();

export function rabbitStatus(): boolean | undefined {
    if (instances.size === 0) return undefined;
    return [...instances.values()].every((instance) => instance.status());
}

export default (connectionString?: string): RabbitConnection => {
    const target = connectionString ?? requireEnv('QUEUE_CONNECTION_URL');
    let instance = instances.get(target);
    if (!instance) {
        instance = new RabbitConnection(target);
        instances.set(target, instance);
        instance.connect().catch((error) => logger.error('[RABBIT] Failed to connect', error));
        const connection = instance;
        onShutdown({ name: 'rabbitmq', close: () => connection.closeConnection() });
    }
    return instance;
};
