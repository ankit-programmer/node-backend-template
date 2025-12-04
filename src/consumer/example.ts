import { Channel } from "amqplib";


export const exampleConsumer = {
    queue: "example_queue",
    batch: 1,
    processor: async (message: any, channel: Channel) => {
        try {
            const content = message.content.toString();
            console.log(`[CONSUMER] Received message: ${content}`);
            // Process the message here
            // Acknowledge the message after processing
            channel.ack(message);
        } catch (error) {
            console.error('[CONSUMER] Error processing message:', error);
            // Optionally, you can nack the message to requeue it
            channel.nack(message);
        }
    }
}

