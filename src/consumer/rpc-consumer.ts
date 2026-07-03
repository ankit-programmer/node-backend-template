import type { Channel } from 'amqplib';
import { Producer } from '../config/producer';
import logger from '../logger';
import type { IConsumer } from './consumer';

let counter = 0;
export const exampleConsumer: IConsumer = {
    queue: 'example_service',
    batch: 1,
    metadata: {
        exchange: {
            name: 'example_service',
        },
        messageTtl: 1000 * 10,
    },
    processor: async (message: any, channel: Channel) => {
        try {
            const { replyTo, correlationId } = message.properties;
            if (replyTo && correlationId) {
                logger.info(`Sending message response to ${replyTo} with correlationId ${correlationId}`);
                Producer().publishToQueue(replyTo, { content: counter++ }, { correlationId, skipAssert: true });
            }
            channel.ack(message);
        } catch (error) {
            logger.error('[CONSUMER] Error processing message:', error);
            channel.nack(message, false, false);
        }
    },
};
