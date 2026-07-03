import { Channel, ConsumeMessage } from "amqplib";
import { IConsumer } from ".";
import logger from "../logger";

export const batchConsumer: IConsumer = {
    queue: "batch_example",
    batch: 10,
    aggregate: {
        enabled: true,
        timeout: 5
    },
    processor: async (messages: ConsumeMessage[], channel: Channel) => {
        for (const message of messages) {
            try {
                const content = JSON.parse(message.content.toString());
                logger.info(`[BatchConsumer] Processing message`, content);
                channel.ack(message);
            } catch (error) {
                logger.error('[BatchConsumer] Failed to process message', error);
                channel.nack(message, false, false);
            }
        }
    }
}
