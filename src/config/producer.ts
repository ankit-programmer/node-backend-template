import rabbitmqService, { Connection, Channel, RabbitConnection } from './rabbitmq';
import logger from "../logger";
import { Metadata } from '../consumer';
import { delay } from '../utility';
import { ConfirmChannel } from 'amqplib';


interface ExchangeOptions { replyTo?: string, correlationId?: string, routingKey?: string, timestamp?: number };
class RabbitMqProducer {
    private rabbitConnection?: Connection;
    private rabbitService: RabbitConnection;
    private rabbitChannel?: ConfirmChannel;
    private initializing: boolean = false;
    constructor(connectionString?: string) {
        this.rabbitService = rabbitmqService(connectionString);
        this.rabbitService.on("connect", () => this.init());
        this.rabbitService.on("error", () => this.init());
        this.init();
    }

    private async init() {
        if (this.initializing) return;
        this.initializing = true;
        this.rabbitChannel?.removeAllListeners()
        await this.rabbitChannel?.close().catch(error => undefined);
        this.rabbitChannel = undefined;
        this.rabbitConnection = undefined;
        let retry = 0;
        while (!this.rabbitConnection || !this.rabbitChannel) {
            await delay(30 * 1000);
            this.rabbitConnection = this.rabbitService.getConnection();
            this.rabbitChannel = await this.rabbitConnection?.createConfirmChannel().catch((err) => {
                logger.error("[RabbitMqProducer] Failed to create channel", { error: err.message });
                return undefined;
            });
            if (this.rabbitChannel) break;
            retry = Math.min(++retry, 30);
            logger.info("[RabbitMqProducer] Waiting for channel");
            await delay(1000 * retry);
        }
        this?.rabbitChannel.once("error", () => this.init());
        this?.rabbitChannel.once("close", () => this.init());
        logger.info("[RabbitMqProducer] Channel created");
        this.initializing = false;
    }

    public async isExchangeAvailable(name: string): Promise<boolean> {
        if (!this.rabbitChannel) return false;
        const exists = await this.rabbitChannel?.checkExchange(name).then(() => true).catch(error => false);
        return exists;
    }
    public async publish(exchange: string, content: any, options: ExchangeOptions) {
        try {
            logger.debug("Publishing to Exchange");
            if (!options.routingKey) options.routingKey = "default";
            content = (typeof content === 'string') ? content : JSON.stringify(content);
            const payloadBuffer: Buffer = Buffer.from(content);
            let status = false;
            let retry = 1;
            while (!status) {
                status = await new Promise((resolve, reject) => {
                    if (!this.rabbitChannel) return resolve(false);
                    this.rabbitChannel?.publish(exchange, options.routingKey!, payloadBuffer, options, (error, ok) => {
                        if (error) return resolve(false);
                        resolve(true);
                    })
                });
                const waitingTimeInSec = Math.max(10, retry++ * 2);
                if (status || retry > 5) break;
                await delay(1000 * waitingTimeInSec);
            }
            if (!status) logger.info(`Failed to publish message to exchange ${exchange} : ${content}`);
            return status;
        } catch (error: any) {
            console.error('[RabbitMqProducer] publish', error);
            throw error;
        }
    }
    public async publishToQueue(queueName: string, payload: any, metadata?: Metadata) {
        try {
            logger.debug('Publishing to Queue');
            payload = (typeof payload === 'string') ? payload : JSON.stringify(payload);
            const payloadBuffer: Buffer = Buffer.from(payload);
            const options: any = { durable: true };
            if (metadata?.exclusive) options.exclusive = metadata.exclusive;
            if (metadata?.messageTtl) options.messageTtl = metadata.messageTtl;
            if (metadata?.deadLetterExchange) options.deadLetterExchange = metadata.deadLetterExchange;
            if (metadata?.deadLetterRoutingKey) options.deadLetterRoutingKey = metadata.deadLetterRoutingKey;
            if (!metadata?.skipAssert) await this.rabbitChannel?.assertQueue(queueName, options);
            let status = false;
            let retry = 1;
            while (!status) {
                status = await new Promise((resolve, reject) => {
                    if (!this.rabbitChannel) return resolve(false);
                    this.rabbitChannel?.sendToQueue(queueName, payloadBuffer, { correlationId: metadata?.correlationId, replyTo: metadata?.replyTo, timestamp: metadata?.timestamp }, (err, ok) => {
                        if (err) return resolve(false);
                        resolve(true);
                    });
                });
                const waitingTimeInSec = Math.max(10, retry++ * 2);
                if (status || retry > 5) break;
                await delay(1000 * waitingTimeInSec);
            }
            if (!status) logger.info(`Failed to publish message to queue ${queueName} : ${payload}`);
            return status;
        } catch (error: any) {
            console.error('[RabbitMqProducer] publishToQueue', error);
            throw error;
        }
    }
}

const instance = new Map<string, RabbitMqProducer>;
export const Producer = (connectionString?: string) => {
    if (!instance.has(connectionString || "default")) instance.set(connectionString || "default", new RabbitMqProducer(connectionString));
    return instance.get(connectionString || "default") as RabbitMqProducer;
}

export default Producer();
