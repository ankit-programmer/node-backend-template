import { Channel } from "amqplib";
import producer from "../config/producer";
import { IConsumer } from ".";
import { delay } from "../utility";
import { compressor } from "../config/redis";

let counter = 0;
export const exampleConsumer: IConsumer = {
    queue: "example_service",
    batch: 1,
    metadata: {
        exchange: {
            name: "example_service"
        },
        messageTtl: 1000 * 10
    },
    processor: async (message: any, channel: Channel) => {
        try {
            const content = message.content.toString();
            const { replyTo, correlationId } = message.properties;
            if (replyTo && correlationId) {
                console.log(`Sending message response to ${replyTo} with correlationId ${correlationId}`);
                const payload = content;
                const user = {
                    "id": 102938,
                    "username": "tech_explorer_99",
                    "isActive": true,
                    "accountBalance": 250.75,
                    "roles": ["user", "beta_tester"],
                    "personalInfo": {
                        "firstName": "Alex",
                        "lastName": "Chen",
                        "email": "alex.chen@example.com"
                    },
                    "preferences": {
                        "theme": "dark",
                        "notificationsEnabled": false,
                        "loginHistory": [
                            "2023-10-15T08:30:00Z",
                            "2023-10-16T09:15:22Z"
                        ]
                    },
                    "lastPurchase": null
                };
                producer.publishToQueue(replyTo, { content: counter++, users: [user, user, user, user] }, { correlationId, skipAssert: true, compressor: compressor.BROTLI });
            }
            channel.ack(message);
        } catch (error) {
            console.error('[CONSUMER] Error processing message:', error);
            // Optionally, you can nack the message to requeue it
            channel.nack(message);
        }
    }
}

