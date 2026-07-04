import type { Channel, ConsumeMessage } from 'amqplib';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const dockerAvailable = inject('dockerAvailable');

describe.skipIf(!dockerAvailable)('RPC over RabbitMQ', () => {
    const EXCHANGE = `rpc-echo-${process.pid}`;
    let rpcClient: typeof import('../../src/config/rpc').rpcClient;
    let rabbit: import('../../src/config/rabbitmq').RabbitConnection;
    let echoConsumer: import('../../src/consumer/consumer').Consumer;

    beforeAll(async () => {
        process.env.QUEUE_CONNECTION_URL = inject('rabbitUrl');
        const { Producer } = await import('../../src/config/producer');
        const { Consumer } = await import('../../src/consumer/consumer');
        ({ rpcClient } = await import('../../src/config/rpc'));
        rabbit = (await import('../../src/config/rabbitmq')).getRabbit();
        await rabbit.connect();

        echoConsumer = new Consumer({
            queue: EXCHANGE,
            batch: 5,
            metadata: { exchange: { name: EXCHANGE } },
            processor: async (message: ConsumeMessage, channel: Channel) => {
                const { replyTo, correlationId } = message.properties;
                const payload = JSON.parse(message.content.toString());
                if (replyTo && correlationId) {
                    await Producer().publishToQueue(replyTo, { echoed: payload }, { correlationId, skipAssert: true });
                }
                channel.ack(message);
            },
        });
    });

    afterAll(async () => {
        await echoConsumer.stop();
        await rabbit.closeConnection();
    });

    it('call() resolves with the consumer reply for its correlationId', async () => {
        const response = await rpcClient(EXCHANGE).call({ n: 1 });
        expect(response).toEqual({ echoed: { n: 1 } });
    });

    it('resolves three concurrent calls with their own responses', async () => {
        const service = rpcClient(EXCHANGE);
        const responses = await Promise.all([service.call({ n: 1 }), service.call({ n: 2 }), service.call({ n: 3 })]);
        expect(responses.map((r) => (r as { echoed: { n: number } }).echoed.n).sort()).toEqual([1, 2, 3]);
    });

    it('rejects with "Request timed out" when nothing replies', async () => {
        const silent = `rpc-silent-${process.pid}`;
        const { Consumer } = await import('../../src/consumer/consumer');
        const sink = new Consumer({
            queue: silent,
            batch: 1,
            metadata: { exchange: { name: silent } },
            processor: (message: ConsumeMessage, channel: Channel) => channel.ack(message), // never replies
        });
        try {
            await expect(rpcClient(silent, { timeout: 3 }).call({ q: 1 })).rejects.toThrow('Request timed out');
        } finally {
            await sink.stop();
        }
    });
});
