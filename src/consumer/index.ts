const args = require('args-parser')(process.argv);
import { Connection, Channel } from "amqplib";
import logger from "../logger";
import rabbitmq from "../config/rabbitmq";
import { delay } from "../utility";
import { exampleConsumer } from "./rpc-consumer";
const CONSUMERS: IConsumer[] = [];
console.log(args, "args");
switch (args?.consumer) {
  case "example":
    CONSUMERS.push(exampleConsumer);
    break;
    break;
  default:
    break;
}

export interface IConsumer {
  queue: string,
  processor: Function,
  clean?: Function,
  batch: number,
  metadata?: Metadata
};
export interface Metadata {
  correlationId?: string;
  replyTo?: string;
  exclusive?: boolean;
  skipAssert?: boolean;
}
export class Consumer {
  private connection?: Connection;
  private channel?: Channel;
  private queue: string;
  private processor: Function;
  private clean?: Function;
  private bufferSize: number = 1;
  private rabbitService;
  private shutdown = false;
  private metadata?: Metadata;
  constructor(obj: IConsumer, connectionString?: string) {
    this.queue = obj.queue;
    this.processor = obj.processor;
    this.bufferSize = obj.batch;
    this.clean = obj.clean;
    this.rabbitService = rabbitmq(connectionString);
    this.metadata = obj.metadata;
    // Setup the consumer
    this.rabbitService.on("connect", async (connection: Connection) => {
      this.connection = connection;
      this.channel = await this.connection?.createChannel();
      this.channel?.prefetch(this.bufferSize);
      const options: any = { durable: true };
      if (this.metadata && this.metadata.exclusive) options.exclusive = this.metadata.exclusive;
      this.channel?.assertQueue(this.queue, options);
      this.start();
    });
    // Stop the consumer if an error occurs
    this.rabbitService.on('error', (error: any) => {
      logger.error(error);
      this.stop();
    });
  }
  private start() {
    this.channel?.consume(this.queue, async (message: any) => {
      if (this.shutdown) {
        console.log("This consumer is shutting down, no longer processing messages");
        return;
      }
      try {
        await this.processor(message, this.channel);
      } catch (error) {
        logger.error(error);
        throw error;
      }
    }, { noAck: false });
    // Stop the consumer if an error occurs
    this.channel?.on('error', (error: any) => {
      this.stop();
      logger.error(error);
    });
  }
  public stop() {
    this.shutdown = true;
    this.clean?.();
  }
  public async queueStatus() {
    let status = { messageCount: 0, consumerCount: 0 };
    if (this.channel) {
      const options: any = { durable: true };
      if (this.metadata && this.metadata.exclusive) options.exclusive = this.metadata.exclusive;
      const queue = await this.channel.assertQueue(this.queue, options).catch(error => { return { messageCount: 0, consumerCount: 0 } });
      status = queue;
    }
    return status;
  }
}

const consumers = CONSUMERS.map(consumer => new Consumer(consumer));

process.on('SIGINT', async () => {
  consumers.forEach(consumer => consumer.stop());
  await delay(10000);
});

process.on('SIGTERM', async () => {
  consumers.forEach(consumer => consumer.stop());
  await delay(10000);
});
