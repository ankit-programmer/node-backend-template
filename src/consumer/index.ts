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
  exchange?: {
    name: string,
    type?: "direct" | "topic" | "fanout",
    routingKey?: string
  }
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
  private initializing: boolean = false;
  constructor(obj: IConsumer, connectionString?: string) {
    this.queue = obj.queue;
    this.processor = obj.processor;
    this.bufferSize = obj.batch;
    this.clean = obj.clean;
    this.metadata = obj.metadata;
    // Setup the consumer
    this.rabbitService = rabbitmq(connectionString);
    this.rabbitService.on("connect", () => this.init());
    this.rabbitService.on("error", () => this.init());
    this.init();
  }
  // Initialize the consumer
  private async init() {
    if (this.initializing) return;
    this.initializing = true;
    this.channel?.removeAllListeners()
    this.channel = undefined;
    this.connection = undefined;
    let retry = 0;
    while (!this.connection || !this.channel) {
      this.connection = this.rabbitService.getConnection();
      this.channel = await this.connection?.createChannel().catch(() => undefined);
      retry = Math.min(++retry, 30);
      logger.info("[Consumer] Waiting for channel")
      await delay(1000 * retry);
    }
    this?.channel.on("error", () => this.init());
    this?.channel.on("close", () => this.init());
    this.start();
    this.initializing = false;
  }

  // Start consumer
  private async start() {
    this.channel?.prefetch(this.bufferSize);
    const options: any = { durable: true };
    if (this.metadata && this.metadata.exclusive) options.exclusive = this.metadata.exclusive;
    await this.channel?.assertQueue(this.queue, options);
    const exchange = this.metadata?.exchange;
    if (exchange) {
      await this.channel?.assertExchange(exchange.name, exchange.type || "direct", { durable: true });
      await this.channel?.bindQueue(this.queue, exchange.name, exchange.routingKey || "default");
    }
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
