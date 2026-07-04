import type { Channel, ConsumeMessage } from 'amqplib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const dockerAvailable = inject('dockerAvailable');

// TEMPLATE: exercises the demo example module end-to-end — retarget to your first real module.
describe.skipIf(!dockerAvailable)('HTTP app against real infrastructure', () => {
    const MASTER_API_KEY = 'integration-master-key';
    let app: import('express').Express;
    let rabbit: import('../../src/config/rabbitmq').RabbitConnection;
    let echoConsumer: import('../../src/consumer/consumer').Consumer;

    beforeAll(async () => {
        process.env.QUEUE_CONNECTION_URL = inject('rabbitUrl');
        process.env.REDIS_CONNECTION_STRING = inject('redisUrl');
        process.env.MASTER_API_KEY = MASTER_API_KEY;
        const { Producer } = await import('../../src/config/producer');
        const { Consumer } = await import('../../src/consumer/consumer');
        rabbit = (await import('../../src/config/rabbitmq')).getRabbit();
        await rabbit.connect();

        // GET /example/:id round-trips through the example_service exchange on a cache miss
        echoConsumer = new Consumer({
            queue: 'example_service',
            batch: 5,
            metadata: { exchange: { name: 'example_service' } },
            processor: async (message: ConsumeMessage, channel: Channel) => {
                const { replyTo, correlationId } = message.properties;
                if (replyTo && correlationId) {
                    await Producer().publishToQueue(
                        replyTo,
                        { received: JSON.parse(message.content.toString()) },
                        { correlationId, skipAssert: true },
                    );
                }
                channel.ack(message);
            },
        });

        ({ app } = { app: (await import('../../src/app')).createApp() });
    });

    afterAll(async () => {
        await echoConsumer.stop();
        await rabbit.closeConnection();
        const { getRedis } = await import('../../src/config/redis');
        await getRedis()
            .close()
            .catch(() => undefined);
    });

    it('reports rabbitmq in the readiness probe once initialized', async () => {
        const res = await request(app).get('/health/ready');
        expect(res.status).toBe(200);
        expect(res.body.checks.rabbitmq).toBe('up');
    });

    it('serves /example/:id end-to-end through the broker and caches the reply', async () => {
        const first = await request(app).get('/example/it-42').set('x-api-key', MASTER_API_KEY);
        expect(first.status).toBe(200);
        expect(first.body.data).toEqual({ received: { id: 'it-42' } });
        expect(first.body.meta).toEqual({ cached: false });

        const second = await request(app).get('/example/it-42').set('x-api-key', MASTER_API_KEY);
        expect(second.status).toBe(200);
        expect(second.body.data).toEqual({ received: { id: 'it-42' } });
        expect(second.body.meta).toEqual({ cached: true });
    });
});
