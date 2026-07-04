// TEMPLATE: demo aggregated (batched) consumer — delete once you have a real one.
import type { Channel, ConsumeMessage } from 'amqplib';
import { logger } from '../logger';
import { toError } from '../utility/error';
import type { IConsumer } from './consumer';

export const batchExampleConsumer: IConsumer = {
    queue: 'batch_example',
    batch: 10,
    aggregate: {
        enabled: true,
        timeout: 5,
    },
    processor: async (messages: ConsumeMessage[], channel: Channel) => {
        for (const message of messages) {
            try {
                const content = JSON.parse(message.content.toString());
                logger.info('[BatchExampleConsumer] Processing message', { content });
                channel.ack(message);
            } catch (error) {
                logger.error('[BatchExampleConsumer] Failed to process message', { err: toError(error) });
                channel.nack(message, false, false);
            }
        }
    },
};
