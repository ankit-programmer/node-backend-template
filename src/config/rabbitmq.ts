import amqp from 'amqplib';
import EventEmitter from 'events';
import logger from '../logger';
import { delay } from '../utility';
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
        this.connectPromise ??= this.setupConnection().then(() => undefined);
        return this.connectPromise;
    }

    private async setupConnection(): Promise<Connection> {
        let retry = 0;
        while (!this.connection && !this.gracefulClose) {
            this.connection = await amqp.connect(this.connectionString).catch(() => undefined);
            if (this.connection) break;
            retry = Math.min(++retry, 30);
            await delay(1000 * retry);
            logger.info('Waiting for Rabbit Connection');
        }
        this.initEventListeners();
        return this.connection!;
    }

    private initEventListeners() {
        if (!this.connection) return;
        logger.info(`[RABBIT](onConnectionReady) Connection established to ${this.connectionString}`);
        this.emit('connect', this.connection);
        this.connection.on('close', (error) => {
            this.connection?.removeAllListeners();
            this.connection = undefined;
            if (this.gracefulClose) {
                logger.info('[RABBIT](onConnectionClosed) Gracefully');
                this.emit('gracefulClose');
            } else {
                logger.error('[RABBIT](onConnectionClosed) Abruptly', error);
                this.setupConnection();
            }
        });

        this.connection.on('error', (error) => {
            logger.error('[Rabbit] Error in Rabbit Connection : ', error);
            this.connection?.removeAllListeners();
            this.connection?.close();
            this.connection = undefined;
            this.setupConnection();
        });
    }

    public closeConnection() {
        this.gracefulClose = true;
        if (this.connection) {
            logger.info('[RABBIT](closeConnection) Closing connection...');
            this.connection.close();
        }
    }

    public getConnection(): Connection | undefined {
        return this.connection;
    }
}

const instances = new Map<string, RabbitConnection>();

export default (connectionString?: string): RabbitConnection => {
    const target = connectionString ?? requireEnv('QUEUE_CONNECTION_URL');
    let instance = instances.get(target);
    if (!instance) {
        instance = new RabbitConnection(target);
        instances.set(target, instance);
        instance.connect().catch((error) => logger.error('[RABBIT] Failed to connect', error));
    }
    return instance;
};
