import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Compressor, decompress } from '../../../src/utility/compression';
import { type FakeRabbitService, makeFakeRabbitService } from '../../helpers/fake-amqp';

const state = vi.hoisted(() => ({ service: undefined as unknown }));

vi.mock('../../../src/config/rabbitmq', () => ({
    getRabbit: () => state.service,
    rabbitStatus: () => true,
}));

type ProducerModule = typeof import('../../../src/config/producer');

async function freshProducer(service: FakeRabbitService = makeFakeRabbitService()) {
    state.service = service;
    vi.resetModules();
    const { Producer } = (await import('../../../src/config/producer')) as ProducerModule;
    const producer = Producer();
    await vi.waitFor(() => expect(service.connection.createConfirmChannel).toHaveBeenCalled());
    return { producer, service, channel: service.connection.channel };
}

describe('RabbitMqProducer', () => {
    beforeEach(() => vi.useRealTimers());
    afterEach(() => vi.useRealTimers());

    it('creates its channel immediately, without a warm-up delay', async () => {
        const started = Date.now();
        const { channel, producer } = await freshProducer();
        expect(await producer.publish('ex', { a: 1 }, {})).toBe(true);
        expect(channel.publish).toHaveBeenCalledTimes(1);
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('stringifies object content and publishes a Buffer', async () => {
        const { producer, channel } = await freshProducer();
        await producer.publish('ex', { hello: 'world' }, {});
        const [, , payload] = channel.publish.mock.calls[0];
        expect(Buffer.isBuffer(payload)).toBe(true);
        expect(JSON.parse(payload.toString())).toEqual({ hello: 'world' });
    });

    it('defaults the routing key to "default"', async () => {
        const { producer, channel } = await freshProducer();
        await producer.publish('ex', 'text', {});
        expect(channel.publish.mock.calls[0][1]).toBe('default');
    });

    it('compresses the payload and stamps contentEncoding', async () => {
        const { producer, channel } = await freshProducer();
        await producer.publish('ex', { big: 'payload' }, { compressor: Compressor.GZIP });
        const [, , payload, options] = channel.publish.mock.calls[0];
        expect(options.contentEncoding).toBe(Compressor.GZIP);
        await expect(decompress(payload, Compressor.GZIP)).resolves.toBe(JSON.stringify({ big: 'payload' }));
    });

    it('retries failed confirms and eventually succeeds', async () => {
        const { producer, channel } = await freshProducer();
        vi.useFakeTimers();
        channel.failConfirms(2);
        const pending = producer.publish('ex', 'retry-me', {});
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toBe(true);
        expect(channel.publish).toHaveBeenCalledTimes(3);
    });

    it('gives up after five attempts and resolves false', async () => {
        const { producer, channel } = await freshProducer();
        vi.useFakeTimers();
        channel.failConfirms(99);
        const pending = producer.publish('ex', 'doomed', {});
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toBe(false);
        expect(channel.publish).toHaveBeenCalledTimes(5);
    });

    it('publishToQueue asserts the queue with metadata-derived options', async () => {
        const { producer, channel } = await freshProducer();
        await producer.publishToQueue('q1', 'payload', {
            messageTtl: 5000,
            deadLetterExchange: 'dlx',
            exclusive: true,
        });
        expect(channel.assertQueue).toHaveBeenCalledWith('q1', {
            durable: true,
            messageTtl: 5000,
            deadLetterExchange: 'dlx',
            exclusive: true,
        });
    });

    it('publishToQueue skips assertion when skipAssert is set', async () => {
        const { producer, channel } = await freshProducer();
        await producer.publishToQueue('q1', 'payload', { skipAssert: true });
        expect(channel.assertQueue).not.toHaveBeenCalled();
        expect(channel.sendToQueue).toHaveBeenCalledTimes(1);
    });

    it('publishToQueue maps correlation metadata onto message options', async () => {
        const { producer, channel } = await freshProducer();
        await producer.publishToQueue('q1', 'payload', {
            correlationId: 'corr-1',
            replyTo: 'reply-q',
            persistent: true,
            skipAssert: true,
        });
        const [, , options] = channel.sendToQueue.mock.calls[0];
        expect(options).toMatchObject({ correlationId: 'corr-1', replyTo: 'reply-q', persistent: true });
    });

    it('isExchangeAvailable reflects checkExchange outcomes', async () => {
        const { producer, channel } = await freshProducer();
        await expect(producer.isExchangeAvailable('ex')).resolves.toBe(true);
        channel.checkExchange.mockRejectedValueOnce(new Error('404'));
        await expect(producer.isExchangeAvailable('ex')).resolves.toBe(false);
    });

    it('reports the exchange unavailable before any channel exists', async () => {
        vi.useFakeTimers();
        const service = makeFakeRabbitService();
        service.getConnection.mockReturnValue(undefined);
        state.service = service;
        vi.resetModules();
        const { Producer } = (await import('../../../src/config/producer')) as ProducerModule;
        await expect(Producer().isExchangeAvailable('ex')).resolves.toBe(false);
    });

    it('recreates the channel when the connection reconnects', async () => {
        const { service, channel } = await freshProducer();
        expect(service.connection.createConfirmChannel).toHaveBeenCalledTimes(1);
        service.emit('connect');
        await vi.waitFor(() => expect(service.connection.createConfirmChannel).toHaveBeenCalledTimes(2));
        expect(channel.close).toHaveBeenCalled();
    });
});
