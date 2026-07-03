import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeConnection } from '../../helpers/fake-amqp';

const amqpMock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('amqplib', () => ({ default: { connect: amqpMock.connect } }));

import { RabbitConnection } from '../../../src/config/rabbitmq';

describe('RabbitConnection', () => {
    beforeEach(() => {
        amqpMock.connect.mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('requires a connection string', () => {
        expect(() => new RabbitConnection('')).toThrow('connectionString is required');
    });

    it('performs no I/O until connect() is called', () => {
        new RabbitConnection('amqp://host');
        expect(amqpMock.connect).not.toHaveBeenCalled();
    });

    it('emits "connect" once the broker connection resolves', async () => {
        const fake = makeFakeConnection();
        amqpMock.connect.mockResolvedValue(fake);
        const rabbit = new RabbitConnection('amqp://host');
        const onConnect = vi.fn();
        rabbit.on('connect', onConnect);
        await rabbit.connect();
        expect(onConnect).toHaveBeenCalledWith(fake);
        expect(rabbit.status()).toBe(true);
        expect(rabbit.getConnection()).toBe(fake);
    });

    it('returns undefined from getConnection before a connection exists', () => {
        expect(new RabbitConnection('amqp://host').getConnection()).toBeUndefined();
    });

    it('retries with growing delays while the broker is unreachable', async () => {
        vi.useFakeTimers();
        const fake = makeFakeConnection();
        amqpMock.connect
            .mockRejectedValueOnce(new Error('refused'))
            .mockRejectedValueOnce(new Error('refused'))
            .mockResolvedValue(fake);
        const rabbit = new RabbitConnection('amqp://host');
        const pending = rabbit.connect();
        await vi.runAllTimersAsync();
        await pending;
        expect(amqpMock.connect).toHaveBeenCalledTimes(3);
        expect(rabbit.status()).toBe(true);
    });

    it('connect() is single-flight', async () => {
        amqpMock.connect.mockResolvedValue(makeFakeConnection());
        const rabbit = new RabbitConnection('amqp://host');
        await Promise.all([rabbit.connect(), rabbit.connect(), rabbit.connect()]);
        expect(amqpMock.connect).toHaveBeenCalledTimes(1);
    });

    it('reconnects after an abrupt close', async () => {
        const first = makeFakeConnection();
        const second = makeFakeConnection();
        amqpMock.connect.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        const rabbit = new RabbitConnection('amqp://host');
        await rabbit.connect();
        const reconnected = new Promise((resolve) => rabbit.once('connect', resolve));
        first.emit('close');
        await expect(reconnected).resolves.toBe(second);
    });

    it('does not reconnect after a graceful close', async () => {
        const fake = makeFakeConnection();
        amqpMock.connect.mockResolvedValue(fake);
        const rabbit = new RabbitConnection('amqp://host');
        await rabbit.connect();
        const onGraceful = vi.fn();
        rabbit.on('gracefulClose', onGraceful);
        await rabbit.closeConnection();
        expect(onGraceful).toHaveBeenCalled();
        expect(amqpMock.connect).toHaveBeenCalledTimes(1);
        expect(rabbit.status()).toBe(false);
    });

    it('closeConnection stops a pending retry loop even while disconnected', async () => {
        vi.useFakeTimers();
        amqpMock.connect.mockRejectedValue(new Error('refused'));
        const rabbit = new RabbitConnection('amqp://host');
        const pending = rabbit.connect();
        await vi.advanceTimersByTimeAsync(1000);
        await rabbit.closeConnection();
        await vi.runAllTimersAsync();
        await pending;
        const attempts = amqpMock.connect.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(amqpMock.connect.mock.calls.length).toBe(attempts);
    });

    it('logs but does not tear down on a connection error event', async () => {
        const fake = makeFakeConnection();
        amqpMock.connect.mockResolvedValue(fake);
        const rabbit = new RabbitConnection('amqp://host');
        await rabbit.connect();
        fake.emit('error', new Error('channel gone'));
        expect(rabbit.status()).toBe(true);
        expect(amqpMock.connect).toHaveBeenCalledTimes(1);
    });
});
