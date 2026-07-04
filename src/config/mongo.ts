import EventEmitter from 'node:events';
import { type Db, MongoClient } from 'mongodb';
import { logger } from '../logger';
import { retryUntil } from '../utility/backoff';
import { toError } from '../utility/error';
import { requireEnv } from './env';
import { connectionRegistry } from './registry';

const RETRY_INTERVAL_MS = 5000;

/**
 * mongo.ts and rabbitmq.ts intentionally mirror each other — same member order,
 * same lifecycle (single-flight connect, retry with backoff, reconnect on abrupt
 * close, graceful close on shutdown). To add a new managed connection type,
 * copy one of them and swap the driver calls.
 */
export class MongoService extends EventEmitter {
    private gracefulClose = false;
    private connectionString: string;
    private connection?: MongoClient;
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

    public async getClient(): Promise<MongoClient> {
        await this.connect();
        if (this.connection) return this.connection;
        return new Promise((resolve) => this.once('connect', resolve));
    }

    public async db(name?: string): Promise<Db> {
        const client = await this.getClient();
        return client.db(name);
    }

    private async setupConnection(): Promise<void> {
        const connection = await retryUntil(
            async () => {
                try {
                    const client = new MongoClient(this.connectionString);
                    return await client.connect();
                } catch (error) {
                    logger.warn('[Mongo] Connect failed', { err: toError(error) });
                    this.emit('retry');
                    return undefined;
                }
            },
            { label: 'mongo-connect', baseMs: RETRY_INTERVAL_MS, shouldStop: () => this.gracefulClose },
        );
        if (!connection) return;
        this.connection = connection;
        this.initEventListeners();
    }

    private initEventListeners(): void {
        if (!this.connection) return;
        logger.info('[Mongo] Connection established');
        this.emit('connect', this.connection);

        this.connection.on('serverClosed', () => {
            this.connection = undefined;
            if (this.gracefulClose) {
                logger.info('[Mongo] Connection closed gracefully');
                this.emit('gracefulClose');
                return;
            }
            logger.error('[Mongo] Connection closed abruptly; reconnecting');
            this.setupConnection();
        });
    }

    public async closeConnection(): Promise<void> {
        this.gracefulClose = true;
        if (this.connection) {
            logger.info('[Mongo] Closing connection...');
            await this.connection.close();
        }
    }
}

const registry = connectionRegistry('mongo', (connectionString) => new MongoService(connectionString));

export const mongoStatus = registry.status;

export function getMongo(connectionString?: string): MongoService {
    return registry.get(connectionString ?? requireEnv('MONGO_URI'));
}
