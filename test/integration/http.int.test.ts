import type { Channel, ConsumeMessage } from 'amqplib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const dockerAvailable = inject('dockerAvailable');

describe.skipIf(!dockerAvailable)('HTTP app against real infrastructure', () => {
    const MASTER_API_KEY = 'integration-master-key';
    let app: import('express').Express;
    let rabbit: import('../../src/config/rabbitmq').RabbitConnection;
    let echoConsumer: import('../../src/consumer/consumer').Consumer;

    beforeAll(async () => {
        process.env.QUEUE_CONNECTION_URL = inject('rabbitUrl');
        process.env.MASTER_API_KEY = MASTER_API_KEY;
        const { Producer } = await import('../../src/config/producer');
        const { Consumer } = await import('../../src/consumer/consumer');
        rabbit = (await import('../../src/config/rabbitmq')).default();
        await rabbit.connect();

        // the /rpc route targets the example_service exchange
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
    });

    it('reports rabbitmq in the readiness probe once initialized', async () => {
        const res = await request(app).get('/health/ready');
        expect(res.status).toBe(200);
        expect(res.body.checks.rabbitmq).toBe('up');
    });

    it('serves /rpc/:id end-to-end through the broker', async () => {
        const res = await request(app).get('/rpc/it-42').set('x-api-key', MASTER_API_KEY);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ received: { id: 'it-42' } });
    });
});
