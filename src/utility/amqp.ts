import type { Options } from 'amqplib';
import type { compressor } from './compression';

export interface Metadata {
    exchange?: {
        name: string;
        type?: 'direct' | 'topic' | 'fanout';
        routingKey?: string;
    };
    compressor?: compressor;
    correlationId?: string;
    replyTo?: string;
    exclusive?: boolean;
    skipAssert?: boolean;
    messageTtl?: number;
    deadLetterExchange?: string;
    deadLetterRoutingKey?: string;
    persistent?: boolean;
    timestamp?: number; // Timestamp in second i.e Math.floor(Date.now()/1000)
}

export function buildQueueOptions(metadata?: Metadata): Options.AssertQueue {
    const options: Options.AssertQueue = { durable: true };
    if (metadata?.exclusive) options.exclusive = metadata.exclusive;
    if (metadata?.messageTtl) options.messageTtl = metadata.messageTtl;
    if (metadata?.deadLetterExchange) options.deadLetterExchange = metadata.deadLetterExchange;
    if (metadata?.deadLetterRoutingKey) options.deadLetterRoutingKey = metadata.deadLetterRoutingKey;
    return options;
}
