import { Channel } from "amqplib";
import producer from "../config/producer";
import { IConsumer } from ".";


export const exampleConsumer: IConsumer = {
    queue: "example_service",
    batch: 1,
    metadata: {
        exchange: {
            name: "example_service"
        }
    },
    processor: async (message: any, channel: Channel) => {
        try {
            const content = message.content.toString();
            const { replyTo, correlationId } = message.properties;
            if (replyTo && correlationId) {
                console.log(`Sending message response to ${replyTo} with correlationId ${correlationId}`);
                const payload = content;
                producer.publishToQueue(replyTo, { content }, { correlationId, skipAssert: true });
            }
            channel.ack(message);
        } catch (error) {
            console.error('[CONSUMER] Error processing message:', error);
            // Optionally, you can nack the message to requeue it
            channel.nack(message);
        }
    }
}

