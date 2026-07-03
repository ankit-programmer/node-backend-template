import type { Channel, ConsumeMessage } from 'amqplib';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const dockerAvailable = inject('dockerAvailable');

// A dedicated broker on a fixed host port: restarting a randomly-mapped container
// changes its host port, which no real deployment does to its clients.
const HOST_PORT = 56720;

describe.skipIf(!dockerAvailable)('broker restart recovery', () => {
    let container: StartedTestContainer;
    let Producer: typeof import('../../src/config/producer').Producer;
    let rabbit: import('../../src/config/rabbitmq').RabbitConnection;
    let consumer: import('../../src/consumer/consumer').Consumer;
    const QUEUE = `it-reconnect-${process.pid}`;
    const received: ConsumeMessage[] = [];

    beforeAll(async () => {
        container = await new GenericContainer('rabbitmq:3-alpine')
            .withExposedPorts({ container: 5672, host: HOST_PORT })
            .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
            .start();
        process.env.QUEUE_CONNECTION_URL = `amqp://localhost:${HOST_PORT}`;
        ({ Producer } = await import('../../src/config/producer'));
        const { Consumer } = await import('../../src/consumer/consumer');
        rabbit = (await import('../../src/config/rabbitmq')).default();
        await rabbit.connect();
        consumer = new Consumer({
            queue: QUEUE,
            batch: 1,
            processor: (message: ConsumeMessage, channel: Channel) => {
                received.push(message);
                channel.ack(message);
            },
        });
    });

    afterAll(async () => {
        await consumer?.stop();
        await rabbit?.closeConnection();
        await container?.stop();
    });

    it('re-emits connect, recovers the producer, and resumes consuming after a broker restart', async () => {
        await expect
            .poll(async () => Producer().publishToQueue(QUEUE, { phase: 'before' }), { timeout: 20_000 })
            .toBe(true);

        const reconnected = new Promise((resolve) => rabbit.once('connect', resolve));
        await container.restart();
        await reconnected;
        expect(rabbit.status()).toBe(true);

        await expect
            .poll(async () => Producer().publishToQueue(QUEUE, { phase: 'after' }), { timeout: 30_000 })
            .toBe(true);
        await expect
            .poll(() => received.some((m) => JSON.parse(m.content.toString()).phase === 'after'), {
                timeout: 30_000,
            })
            .toBe(true);
    });
});
