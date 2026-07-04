import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFakeChannel, makeMessage } from '../../helpers/fake-amqp';

const mocks = vi.hoisted(() => ({
    producer: {
        isExchangeAvailable: vi.fn(async (_name: string) => true),
        publish: vi.fn(async (_exchange: string, _content: any, _options: any) => true),
    },
    consumerCalls: [] as any[],
}));

vi.mock('../../../src/config/producer', () => ({
    Producer: () => mocks.producer,
}));

vi.mock('../../../src/consumer/consumer', () => ({
    Consumer: class {
        constructor(obj: any) {
            mocks.consumerCalls.push(obj);
        }
    },
}));

import { rpcClient } from '../../../src/config/rpc';

let uniqueId = 0;
function freshService(options?: { timeout?: number; concurrency?: number }) {
    // unique name per test: the factory memoizes by name+options
    return rpcClient(`svc-${++uniqueId}`, options);
}

function lastProcessor() {
    return mocks.consumerCalls[mocks.consumerCalls.length - 1].processor;
}

describe('rpcClient', () => {
    afterEach(() => {
        vi.useRealTimers();
        mocks.producer.isExchangeAvailable.mockClear().mockResolvedValue(true as never);
        mocks.producer.publish.mockClear().mockResolvedValue(true as never);
        mocks.consumerCalls.length = 0;
    });

    it('is a factory, not a constructor', () => {
        expect(() => new (rpcClient as any)('nope')).toThrow(TypeError);
        const service = freshService();
        expect(typeof service.call).toBe('function');
        expect(typeof service.publish).toBe('function');
    });

    it('memoizes instances by name and options', () => {
        const a = rpcClient('memo-test', { timeout: 5 });
        const b = rpcClient('memo-test', { timeout: 5 });
        const c = rpcClient('memo-test', { timeout: 9 });
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    it('resolves call() with the parsed JSON response for its correlationId', async () => {
        const service = freshService();
        const pending = service.call({ q: 1 });
        await vi.waitFor(() => expect(mocks.producer.publish).toHaveBeenCalled());
        const [, , publishOptions] = mocks.producer.publish.mock.calls[0];
        const channel = makeFakeChannel();
        lastProcessor()(makeMessage({ answer: 42 }, { correlationId: publishOptions.correlationId }), channel);
        await expect(pending).resolves.toEqual({ answer: 42 });
        expect(channel.ack).toHaveBeenCalledTimes(1);
    });

    it('passes a non-JSON response through as a raw string', async () => {
        const service = freshService();
        const pending = service.call({});
        await vi.waitFor(() => expect(mocks.producer.publish).toHaveBeenCalled());
        const { correlationId } = mocks.producer.publish.mock.calls[0][2];
        lastProcessor()(makeMessage('plain text', { correlationId }), makeFakeChannel());
        await expect(pending).resolves.toBe('plain text');
    });

    it('rejects with "Request timed out" and removes its listener', async () => {
        vi.useFakeTimers();
        const service = freshService({ timeout: 2 });
        const pending = service.call({});
        pending.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(2000);
        await expect(pending).rejects.toThrow('Request timed out');
        expect((service as any).eventNames()).toHaveLength(0);
    });

    it('rejects when the publish fails and cleans up', async () => {
        mocks.producer.publish.mockRejectedValue(new Error('broker down'));
        const service = freshService();
        await expect(service.call({})).rejects.toThrow('Failed to send request: broker down');
        expect((service as any).eventNames()).toHaveLength(0);
    });

    it('rejects when the exchange never becomes available', async () => {
        mocks.producer.isExchangeAvailable.mockResolvedValue(false as never);
        vi.useFakeTimers();
        const service = freshService({ timeout: 2 });
        const pending = service.call({});
        pending.catch(() => undefined);
        await vi.runAllTimersAsync();
        await expect(pending).rejects.toThrow();
    });

    it('resolves concurrent calls independently', async () => {
        const service = freshService();
        const first = service.call({ n: 1 });
        const second = service.call({ n: 2 });
        await vi.waitFor(() => expect(mocks.producer.publish).toHaveBeenCalledTimes(2));
        const ids = mocks.producer.publish.mock.calls.map(([, , options]) => options.correlationId);
        expect(new Set(ids).size).toBe(2);
        const processor = lastProcessor();
        const channel = makeFakeChannel();
        processor(makeMessage({ for: 'second' }, { correlationId: ids[1] }), channel);
        processor(makeMessage({ for: 'first' }, { correlationId: ids[0] }), channel);
        await expect(first).resolves.toEqual({ for: 'first' });
        await expect(second).resolves.toEqual({ for: 'second' });
    });

    it('acks a response message even when handling it throws', async () => {
        const service = freshService();
        service.call({}).catch(() => undefined);
        await vi.waitFor(() => expect(mocks.consumerCalls.length).toBeGreaterThan(0));
        const channel = makeFakeChannel();
        lastProcessor()({ content: null, properties: {} }, channel); // content.toString() throws
        expect(channel.ack).toHaveBeenCalledTimes(1);
    });

    it('creates exactly one reply-queue consumer across calls', async () => {
        const service = freshService();
        await Promise.all([service.publish({}), service.publish({})]);
        expect(mocks.consumerCalls.length).toBe(1);
    });

    it('publish() resolves the producer status and never rejects', async () => {
        const service = freshService();
        await expect(service.publish({ fire: 'forget' })).resolves.toBe(true);
        mocks.producer.publish.mockRejectedValue(new Error('nope'));
        await expect(service.publish({})).resolves.toBe(false);
    });

    it('sizes maxListeners to concurrency plus headroom', () => {
        const service = freshService({ concurrency: 50 });
        expect((service as any).getMaxListeners()).toBeGreaterThanOrEqual(50);
    });
});
