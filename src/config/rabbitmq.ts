import amqp from 'amqplib';
import EventEmitter from 'events';
import logger from '../logger';
import { delay } from '../utility';
import env from './env';
export type Connection = amqp.Connection;
export type Channel = amqp.Channel;

const RABBIT_CONNECTION_STRING = env.QUEUE_CONNECTION_URL;
if (!RABBIT_CONNECTION_STRING) throw new Error("RABBIT_CONNECTION_STRING is not defined in environment variables");

export class RabbitConnection extends EventEmitter {
    private static instance: RabbitConnection;
    private gracefulClose: boolean = false;
    private connectionString: string;
    private connection?: Connection;

    constructor(connectionString: string) {
        super();
        if (!connectionString) throw new Error("connectionString is required");
        this.connectionString = connectionString;
        this.setupConnection();
    }

    public static getSingletonInstance(connectionString: string): RabbitConnection {
        return RabbitConnection.instance ||= new RabbitConnection(connectionString);
    }

    public status() {
        return !!this.connection;
    }

    private async setupConnection(): Promise<Connection> {
        let retry = 0;
        while (!this.connection && !this.gracefulClose) {
            this.connection = await amqp.connect(this.connectionString).catch((error) => undefined);
            retry = Math.min(++retry, 30);
            await delay(1000 * retry);
            logger.info("Waiting for Rabbit Connection");
        }
        this.initEventListeners();
        return this.connection!;
    }

    private initEventListeners() {
        if (!this.connection) return;
        logger.info(`[RABBIT](onConnectionReady) Connection established to ${this.connectionString}`);
        this.emit("connect", this.connection);
        this.connection.on("close", (error) => {
            this.connection?.removeAllListeners();
            this.connection = undefined;
            if (this.gracefulClose) {
                logger.info('[RABBIT](onConnectionClosed) Gracefully');
                this.emit("gracefulClose");
            } else {
                logger.error('[RABBIT](onConnectionClosed) Abruptly', error);
                // this.emit("error", error);
            }

            if (!this.gracefulClose) this.setupConnection();
        });

        this.connection.on("error", (error) => {
            logger.error("[Rabbit] Error in Rabbit Connection : ", error);
            this.connection?.removeAllListeners();
            this.connection?.close();
            this.connection = undefined;
            this.setupConnection();
        })
    }

    public closeConnection() {
        if (this.connection) {
            this.gracefulClose = true;
            logger.info('[RABBIT](closeConnection) Closing connection...');
            this.connection.close();
        }
    }

    public getConnection(): Connection | undefined {
        return this.connection;
    }
}

export default (connectionString: string = RABBIT_CONNECTION_STRING): RabbitConnection => {
    return RabbitConnection.getSingletonInstance(connectionString);
}
