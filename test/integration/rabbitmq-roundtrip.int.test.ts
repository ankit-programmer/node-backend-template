import type { Channel, ConsumeMessage } from 'amqplib';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const dockerAvailable = inject('dockerAvailable');

describe.skipIf(!dockerAvailable)('RabbitMQ publish/consume round-trip', () => {
    let Producer: typeof import('../../src/config/producer').Producer;
    let Consumer: typeof import('../../src/consumer/consumer').Consumer;
    let rabbit: import('../../src/config/rabbitmq').RabbitConnection;
    const consumers: import('../../src/consumer/consumer').Consumer[] = [];

    beforeAll(async () => {
        process.env.QUEUE_CONNECTION_URL = inject('rabbitUrl');
        ({ Producer } = await import('../../src/config/producer'));
        ({ Consumer } = await import('../../src/consumer/consumer'));
        rabbit = (await import('../../src/config/rabbitmq')).default();
        await rabbit.connect();
    });

    afterAll(async () => {
        for (const consumer of consumers) await consumer.stop();
        await rabbit.closeConnection();
    });

    function consumeOne(queue: string): Promise<ConsumeMessage> {
        return new Promise((resolve) => {
            const consumer = new Consumer({
                queue,
                batch: 1,
                processor: (message: ConsumeMessage, channel: Channel) => {
                    channel.ack(message);
                    resolve(message);
                },
            });
            consumers.push(consumer);
        });
    }

    it('delivers an uncompressed payload', async () => {
        const queue = `it-plain-${process.pid}`;
        const received = consumeOne(queue);
        await Producer().publishToQueue(queue, { kind: 'plain' });
        const message = await received;
        expect(JSON.parse(message.content.toString())).toEqual({ kind: 'plain' });
    });

    it.each([
        'snappy',
        'gzip',
        'brotli',
    ] as const)('transparently decompresses a %s payload via contentEncoding', async (lib) => {
        const queue = `it-${lib}-${process.pid}`;
        const received = consumeOne(queue);
        await Producer().publishToQueue(queue, { kind: lib }, { compressor: lib as any });
        const message = await received;
        expect(JSON.parse(message.content.toString())).toEqual({ kind: lib });
    });

    it('routes an exchange publish to a bound queue', async () => {
        const queue = `it-exchange-${process.pid}`;
        const exchange = `it-ex-${process.pid}`;
        const received = new Promise<ConsumeMessage>((resolve) => {
            consumers.push(
                new Consumer({
                    queue,
                    batch: 1,
                    metadata: { exchange: { name: exchange, routingKey: 'route-a' } },
                    processor: (message: ConsumeMessage, channel: Channel) => {
                        channel.ack(message);
                        resolve(message);
                    },
                }),
            );
        });
        await new Promise((resolve) => setTimeout(resolve, 500)); // let the binding assert
        await Producer().publish(exchange, { via: 'exchange' }, { routingKey: 'route-a' });
        expect(JSON.parse((await received).content.toString())).toEqual({ via: 'exchange' });
    });

    it('aggregates a full batch into one processor call', async () => {
        const queue = `it-agg-${process.pid}`;
        const received = new Promise<ConsumeMessage[]>((resolve) => {
            consumers.push(
                new Consumer({
                    queue,
                    batch: 5,
                    aggregate: { enabled: true, timeout: 30 },
                    processor: (messages: ConsumeMessage[], channel: Channel) => {
                        for (const message of messages) channel.ack(message);
                        resolve(messages);
                    },
                }),
            );
        });
        for (let i = 0; i < 5; i++) await Producer().publishToQueue(queue, { i });
        const batch = await received;
        expect(batch).toHaveLength(5);
    });

    it('flushes a partial batch after the aggregate timeout', async () => {
        const queue = `it-agg-partial-${process.pid}`;
        const received = new Promise<ConsumeMessage[]>((resolve) => {
            consumers.push(
                new Consumer({
                    queue,
                    batch: 50,
                    aggregate: { enabled: true, timeout: 2 },
                    processor: (messages: ConsumeMessage[], channel: Channel) => {
                        for (const message of messages) channel.ack(message);
                        resolve(messages);
                    },
                }),
            );
        });
        await Producer().publishToQueue(queue, { only: 'one' });
        await Producer().publishToQueue(queue, { only: 'two' });
        const batch = await received;
        expect(batch.length).toBe(2);
    });
});
