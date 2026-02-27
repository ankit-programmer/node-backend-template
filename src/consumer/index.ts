const args = require('args-parser')(process.argv);
import { Connection, Channel, ConsumeMessage } from "amqplib";
import logger from "../logger";
import rabbitmq from "../config/rabbitmq";
import { delay } from "../utility";
import { exampleConsumer } from "./rpc-consumer";
import EventEmitter from "events";
import { batchConsumer } from "./batch-testing";
const CONSUMERS: IConsumer[] = [];
console.log(args, "args");
switch (args?.consumer) {
  case "example":
    CONSUMERS.push(exampleConsumer);
    break;
  case "batch":
    CONSUMERS.push(batchConsumer);
    break;
    break;
  default:
    break;
}


// Base Interface
interface IConsumerBase {
  queue: string;
  clean?: () => void;
  batch: number;
  metadata?: Metadata;
}

// Aggregate is enabled -> processor takes an array
interface IConsumerAggregated extends IConsumerBase {
  aggregate: {
    enabled: true;
    timeout?: number
  };
  processor: (messages: ConsumeMessage[], channel: Channel) => any;
}

// Aggregate is false or omitted -> processor takes a single message
interface IConsumerSingle extends IConsumerBase {
  aggregate?: {
    enabled?: false;
    timeout?: number
  };
  processor: (message: ConsumeMessage, channel: Channel) => any;
}

// Final consumer interface
export type IConsumer = IConsumerAggregated | IConsumerSingle;
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
  messageTtl?: number;
  deadLetterExchange?: string;
  deadLetterRoutingKey?: string;
  timestamp?: number; // Timestamp in second i.e Math.floor(Date.now()/1000)
}
class Batch extends EventEmitter {
  private size: number;
  private timeout: number | undefined;
  private queue: Array<any>;
  private timeoutRef?: NodeJS.Timeout = undefined;
  constructor(size: number, timeoutInSec?: number) {
    super();
    this.size = size;
    this.timeout = timeoutInSec;
    this.queue = new Array();
  }

  public push(message: any) {
    this.queue.push(message);
    if (this.queue.length >= this.size) {
      // Cancel existing timer
      this.timeoutRef && clearTimeout(this.timeoutRef);
      // Trigger event
      this.emit("process", this.queue.splice(0, this.size));
    }
    if (!this.timeout) return;
    if (this.queue.length == 1) {
      // Cancel existing timer
      this.timeoutRef && clearTimeout(this.timeoutRef);
      // Start timer
      this.timeoutRef = setTimeout(() => {
        const batch = this.queue.splice(0, this.size);
        if (batch.length) this.emit("process", batch);
      }, this.timeout * 1000);
    }
  }
  public clear() {
    this.queue = new Array();
    this.timeoutRef && clearTimeout(this.timeoutRef);
  }
}
export class Consumer {
  private connection?: Connection;
  private channel?: Channel;
  private queue: string;
  private processor: IConsumer['processor'];
  private clean?: Function;
  private bufferSize: number = 1;
  private rabbitService;
  private aggregate: boolean = false;
  private shutdown = false;
  private metadata?: Metadata;
  private initializing: boolean = false;
  private batch: Batch;
  constructor(obj: IConsumer, connectionString?: string) {
    this.queue = obj.queue;
    this.processor = obj.processor;
    this.bufferSize = obj.batch;
    this.clean = obj.clean;
    this.metadata = obj.metadata;
    // Setup aggregation
    this.aggregate = obj.aggregate?.enabled || false;
    const batchSize = this.aggregate ? this.bufferSize : 1; // Only batch if aggregation is enabled
    this.batch = new Batch(batchSize, obj.aggregate?.timeout);
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
    this.batch.removeAllListeners();
    this.batch.clear();
    this.start().catch(error => logger.error(error));
    this.initializing = false;
  }

  // Start consumer
  private async start() {
    // Setup consumer settings
    this.channel?.prefetch(this.bufferSize);
    const options: any = { durable: true };
    if (this.metadata?.exclusive) options.exclusive = this.metadata.exclusive;
    if (this.metadata?.messageTtl) options.messageTtl = this.metadata.messageTtl;
    if (this.metadata?.deadLetterExchange) options.deadLetterExchange = this.metadata.deadLetterExchange;
    if (this.metadata?.deadLetterRoutingKey) options.deadLetterRoutingKey = this.metadata.deadLetterRoutingKey;
    if (!this.metadata?.skipAssert) await this.channel?.assertQueue(this.queue, options);
    const exchange = this.metadata?.exchange;
    if (exchange) {
      await this.channel?.assertExchange(exchange.name, exchange.type || "direct", { durable: true });
      await this.channel?.bindQueue(this.queue, exchange.name, exchange.routingKey || "default");
    }

    // Start consuming messages
    this.channel?.consume(this.queue, async (message: ConsumeMessage | null) => this.batch.push(message), { noAck: false });
    this.batch.on("process", async (messages: any[]) => {
      if (this.shutdown) {
        console.log("This consumer is shutting down, no longer processing messages");
        return;
      }
      try {
        (this.aggregate) ? await this.processor(messages as any, this.channel!) : await this.processor(messages[0], this.channel!);
      } catch (error) {
        logger.error(error);
        throw error;
      }
    })
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


