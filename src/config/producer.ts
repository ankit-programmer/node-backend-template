import rabbitmqService, { Connection, Channel } from './rabbitmq';
import logger from "../logger";
import { Metadata } from '../consumer';

let rabbitConnection: Connection;
let rabbitChannel: Channel;
interface ExchangeOptions { replyTo?: string, correlationId?: string, routingKey?: string };
class RabbitMqProducer {
    private static instance: RabbitMqProducer;

    constructor() {
        logger.info(`[PRODUCER] Listening for connection...`);
        // console.log(rabbitmqService());
        rabbitmqService().on("connect", async (connection) => {
            logger.info(`[PRODUCER] Connection received...`);
            rabbitConnection = connection;
            logger.info(`[PRODUCER] Creating channel...`);
            rabbitChannel = await rabbitConnection.createChannel();
        }).on("error", (error) => {
        })
    }

    public static getSingletonInstance(): RabbitMqProducer {
        return RabbitMqProducer.instance ||= new RabbitMqProducer();
    }
    public async isExchangeAvailable(name: string): Promise<boolean> {
        try {
            const exists = await rabbitChannel.checkExchange(name);
            return true;
        } catch (error) {
            return false;
        }
        return false;
    }
    public async publish(exchange: string, content: any, options: ExchangeOptions) {
        try {
            if (!options.routingKey) options.routingKey = "default";
            content = (typeof content === 'string') ? content : JSON.stringify(content);
            const payloadBuffer: Buffer = Buffer.from(content);
            rabbitChannel.publish(exchange, options.routingKey, payloadBuffer, options);
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
            if (metadata && metadata.exclusive) options.exclusive = metadata.exclusive;
            if (!metadata?.skipAssert) await rabbitChannel.assertQueue(queueName, options);
            rabbitChannel.sendToQueue(queueName, payloadBuffer, { correlationId: metadata?.correlationId, replyTo: metadata?.replyTo });
        } catch (error: any) {
            console.error('[RabbitMqProducer] publishToQueue', error);
            throw error;
        }
    }
}

export default RabbitMqProducer.getSingletonInstance();
