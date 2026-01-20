import rabbitmqService, { Connection, Channel } from './rabbitmq';
import logger from "../logger";
import { Metadata } from '../consumer';

let rabbitConnection: Connection;
let rabbitChannel: Channel;
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
        });
    }

    public static getSingletonInstance(): RabbitMqProducer {
        return RabbitMqProducer.instance ||= new RabbitMqProducer();
    }
    public async publish(exchange: string, content: any, routingKey: string = "default") {
        try {
            content = (typeof content === 'string') ? content : JSON.stringify(content);
            const payloadBuffer: Buffer = Buffer.from(content);
            rabbitChannel.publish(exchange, routingKey, payloadBuffer);
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
