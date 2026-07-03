
import { EventEmitter } from "stream";
import { IConsumer } from ".";
import { Producer } from "../config/producer";
import { Channel } from "../config/rabbitmq";
import { ConsumeMessage } from "amqplib";

const BATCH_SIZE = 500;

export const tempConsumer: IConsumer = {
    queue: "wa-dlr-reports-failed",
    batch: BATCH_SIZE,
    aggregate: {
        enabled: true,
        timeout: 5
    },
    processor: async (messages: ConsumeMessage[], channel: Channel) => {
        for (const message of messages) {
            Producer("amqps://yliwdghz:TmdjZrwfmVV5HrQ1cDJ83jlnen-IQnAo@quick-brown-crow.rmq5.cloudamqp.com/yliwdghz").publishToQueue("wa-dlr-report-temp", message.content?.toString()).then((result)=>{
            if (result) channel.ack(message);
            });
        }
    }
}