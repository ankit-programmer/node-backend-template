// TEMPLATE: demo RPC echo consumer — replies on the example_service exchange; delete with the example module.
import type { Channel, ConsumeMessage } from 'amqplib';
import { Producer } from '../config/producer';
import { logger } from '../logger';
import { toError } from '../utility/error';
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
    processor: async (message: ConsumeMessage, channel: Channel) => {
        try {
            const { replyTo, correlationId } = message.properties;
            if (replyTo && correlationId) {
                logger.info(`[ExampleConsumer] Replying to ${replyTo} with correlationId ${correlationId}`);
                Producer().publishToQueue(replyTo, { content: counter++ }, { correlationId, skipAssert: true });
            }
            channel.ack(message);
        } catch (error) {
            logger.error('[ExampleConsumer] Failed to process message', { err: toError(error) });
            channel.nack(message, false, false);
        }
    },
};
