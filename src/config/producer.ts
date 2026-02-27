import rabbitmqService, { Connection, Channel, RabbitConnection } from './rabbitmq';
import logger from "../logger";
import { Metadata } from '../consumer';
import { delay } from '../utility';


interface ExchangeOptions { replyTo?: string, correlationId?: string, routingKey?: string, timestamp?: number };
class RabbitMqProducer {
    private rabbitConnection?: Connection;
    private rabbitService: RabbitConnection;
    private rabbitChannel?: Channel;
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
        this.rabbitChannel = undefined;
        this.rabbitConnection = undefined;
        let retry = 0;
        while (!this.rabbitConnection || !this.rabbitChannel) {
            this.rabbitConnection = this.rabbitService.getConnection();
            this.rabbitChannel = await this.rabbitConnection?.createChannel().catch(() => undefined);
            retry = Math.min(++retry, 30);
            logger.info("[RabbitMqProducer] Waiting for channel");
            await delay(1000 * retry);
        }
        this?.rabbitChannel.on("error", () => this.init());
        this?.rabbitChannel.on("close", () => this.init());

        this.initializing = false;
    }

    public async isExchangeAvailable(name: string): Promise<boolean> {
        if (!this.rabbitChannel) return false;
        const exists = await this.rabbitChannel?.checkExchange(name).then(() => true).catch(error => false);
        return exists;
    }
    public async publish(exchange: string, content: any, options: ExchangeOptions) {
        try {
            if (!options.routingKey) options.routingKey = "default";
            content = (typeof content === 'string') ? content : JSON.stringify(content);
            const payloadBuffer: Buffer = Buffer.from(content);
            this.rabbitChannel?.publish(exchange, options.routingKey, payloadBuffer, options);
        } catch (error: any) {
            console.error('[RabbitMqProducer] publish', error);
            throw error;
        }
    }
    public async publishToQueue(queueName: string, payload: any, metadata?: Metadata) {
        try {
            payload = (typeof payload === 'string') ? payload : JSON.stringify(payload);
            const payloadBuffer: Buffer = Buffer.from(payload);
            const options: any = { durable: true };
            if (metadata?.exclusive) options.exclusive = metadata.exclusive;
            if (metadata?.messageTtl) options.messageTtl = metadata.messageTtl;
            if (metadata?.deadLetterExchange) options.deadLetterExchange = metadata.deadLetterExchange;
            if (metadata?.deadLetterRoutingKey) options.deadLetterRoutingKey = metadata.deadLetterRoutingKey;
            if (!metadata?.skipAssert) await this.rabbitChannel?.assertQueue(queueName, options);
            this.rabbitChannel?.sendToQueue(queueName, payloadBuffer, { correlationId: metadata?.correlationId, replyTo: metadata?.replyTo, timestamp: metadata?.timestamp });
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
