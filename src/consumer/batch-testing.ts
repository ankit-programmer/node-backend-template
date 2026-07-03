
import { EventEmitter } from "stream";
import { IConsumer } from ".";
import producer from "../config/producer";
import { Channel } from "../config/rabbitmq";
import { ConsumeMessage } from "amqplib";

const BATCH_SIZE = 10;

export const batchConsumer: IConsumer = {
    queue: "batch",
    batch: BATCH_SIZE,
    aggregate: {
        enabled: true,
        timeout: 5
    },
    processor: (messages: ConsumeMessage[], channel: Channel) => {
        messages.forEach((message) => console.log(message.content?.toString()));
    }
}

/**
 * We need a batching mechanisam which removes folowing issues:
 *  - Race condition while acknowledging (We need the items in same order as they came in)
 *  - Easy interface to use batch
 *  - Empty batch when channel/connection retry
 *  - Support for timeout if batch is filling too slowly
 */


