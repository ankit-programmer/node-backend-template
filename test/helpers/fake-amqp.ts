import EventEmitter from 'node:events';
import { vi } from 'vitest';

type ConfirmCallback = (error: Error | null) => void;

export interface FakeChannel extends EventEmitter {
    publish: ReturnType<typeof vi.fn>;
    sendToQueue: ReturnType<typeof vi.fn>;
    assertQueue: ReturnType<typeof vi.fn>;
    assertExchange: ReturnType<typeof vi.fn>;
    bindQueue: ReturnType<typeof vi.fn>;
    checkExchange: ReturnType<typeof vi.fn>;
    prefetch: ReturnType<typeof vi.fn>;
    consume: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    ack: ReturnType<typeof vi.fn>;
    nack: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    /** Makes the next n confirm callbacks report failure. */
    failConfirms(n: number): void;
    /** The handler registered via consume(); push fake messages through it. */
    consumeHandler?: (message: any) => Promise<void> | void;
}

export function makeFakeChannel(): FakeChannel {
    const channel = new EventEmitter() as FakeChannel;
    let confirmFailures = 0;
    const confirm = (cb: ConfirmCallback) => {
        if (confirmFailures > 0) {
            confirmFailures--;
            cb(new Error('confirm failed'));
        } else {
            cb(null);
        }
    };
    channel.failConfirms = (n: number) => {
        confirmFailures = n;
    };
    channel.publish = vi.fn((_exchange, _routingKey, _content, _options, cb: ConfirmCallback) => {
        confirm(cb);
        return true;
    });
    channel.sendToQueue = vi.fn((_queue, _content, _options, cb: ConfirmCallback) => {
        confirm(cb);
        return true;
    });
    channel.assertQueue = vi.fn(async (queue: string) => ({ queue, messageCount: 0, consumerCount: 0 }));
    channel.assertExchange = vi.fn(async (exchange: string) => ({ exchange }));
    channel.bindQueue = vi.fn(async () => ({}));
    channel.checkExchange = vi.fn(async () => ({}));
    channel.prefetch = vi.fn(async () => undefined);
    channel.consume = vi.fn(async (queue: string, handler: FakeChannel['consumeHandler']) => {
        channel.consumeHandler = handler;
        return { consumerTag: `tag-${queue}` };
    });
    channel.cancel = vi.fn(async () => ({}));
    channel.ack = vi.fn();
    channel.nack = vi.fn();
    channel.close = vi.fn(async () => undefined);
    return channel;
}

export interface FakeConnection extends EventEmitter {
    createChannel: ReturnType<typeof vi.fn>;
    createConfirmChannel: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    channel: FakeChannel;
}

export function makeFakeConnection(channel: FakeChannel = makeFakeChannel()): FakeConnection {
    const connection = new EventEmitter() as FakeConnection;
    connection.channel = channel;
    connection.createChannel = vi.fn(async () => channel);
    connection.createConfirmChannel = vi.fn(async () => channel);
    connection.close = vi.fn(async () => {
        connection.emit('close');
    });
    return connection;
}

export interface FakeRabbitService extends EventEmitter {
    getConnection: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    closeConnection: ReturnType<typeof vi.fn>;
    connection: FakeConnection;
}

export function makeFakeRabbitService(connection: FakeConnection = makeFakeConnection()): FakeRabbitService {
    const service = new EventEmitter() as FakeRabbitService;
    service.connection = connection;
    service.getConnection = vi.fn(() => connection);
    service.connect = vi.fn(async () => undefined);
    service.status = vi.fn(() => true);
    service.closeConnection = vi.fn(async () => undefined);
    return service;
}

export function makeMessage(content: unknown, properties: Record<string, unknown> = {}) {
    const buffer = Buffer.isBuffer(content)
        ? content
        : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content));
    return { content: buffer, properties, fields: {} };
}
