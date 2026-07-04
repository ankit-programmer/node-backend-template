import EventEmitter from 'node:events';
import { type Db, MongoClient } from 'mongodb';
import { onShutdown } from '../lifecycle/shutdown';
import logger from '../logger';
import { retryUntil } from '../utility/backoff';
import { requireEnv } from './env';

const RETRY_INTERVAL = 5000; // in millis

export class MongoService extends EventEmitter {
    private gracefulClose: boolean = false;
    private connectionString: string;
    private connection?: MongoClient;
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
        this.connectPromise ??= this.setupConnection().then(() => undefined);
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
                    logger.error('[MONGO](setupConnection)', error);
                    this.emit('retry');
                    return undefined;
                }
            },
            { label: 'mongo-connect', baseMs: RETRY_INTERVAL, shouldStop: () => this.gracefulClose },
        );
        if (!connection) return;
        this.connection = connection;
        this.initEventListeners();
    }

    private initEventListeners() {
        if (!this.connection) return;
        logger.info(`[MONGO](onConnectionReady) Connection established to ${this.connectionString}`);
        this.emit('connect', this.connection);

        this.connection.on('serverClosed', (error: any) => {
            this.connection = undefined;

            if (this.gracefulClose) {
                logger.info('[MONGO](onConnectionClosed) Gracefully');
                this.emit('gracefulClose');
            } else {
                logger.error('[MONGO](onConnectionClosed) Abruptly', error);
                this.setupConnection();
            }
        });
    }

    public async closeConnection(): Promise<void> {
        this.gracefulClose = true;
        if (this.connection) {
            logger.info('[MONGO](closeConnection) Closing connection...');
            await this.connection.close();
        }
    }
}

const instances = new Map<string, MongoService>();

export function mongoStatus(): boolean | undefined {
    if (instances.size === 0) return undefined;
    return [...instances.values()].every((instance) => instance.status());
}

export default (connectionString?: string): MongoService => {
    const target = connectionString ?? requireEnv('MONGO_URI');
    let instance = instances.get(target);
    if (!instance) {
        instance = new MongoService(target);
        instances.set(target, instance);
        instance.connect().catch((error) => logger.error('[MONGO] Failed to connect', error));
        const service = instance;
        onShutdown({ name: 'mongo', close: () => service.closeConnection() });
    }
    return instance;
};
