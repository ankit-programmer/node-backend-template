import EventEmitter from 'node:events';
import type { ConsumeMessage } from 'amqplib';
import { nanoid } from 'nanoid';
import hash from 'object-hash';
import { v4 as uuidv4 } from 'uuid';
import { Consumer } from '../consumer/consumer';
import { logger } from '../logger';
import { retryUntil } from '../utility/backoff';
import { toError } from '../utility/error';
import { env } from './env';
import { Producer } from './producer';
import type { Channel } from './rabbitmq';

export interface RpcOptions {
    timeout?: number; // in seconds
    concurrency?: number; // number of concurrent responses to handle; default 20
}

const EXTRA_LISTENER_HEADROOM = 10;
const DEFAULT_CONCURRENCY = 20;
const CLIENT_ID_LENGTH = 5;

export class RpcClient extends EventEmitter {
    private id: string;
    private name: string;
    private consumer?: Consumer;
    private readyPromise?: Promise<void>;
    private options: Required<RpcOptions>;

    constructor(name: string, options?: RpcOptions) {
        super();
        this.options = { timeout: env.RPC_TIMEOUT_SEC, concurrency: DEFAULT_CONCURRENCY, ...options };
        this.setMaxListeners(this.options.concurrency + EXTRA_LISTENER_HEADROOM);
        this.id = `${name}-rpc-client-${nanoid(CLIENT_ID_LENGTH)}`;
        this.name = name;
    }

    /** Resolves once the reply queue consumer exists and the target exchange is reachable. */
    private ready(): Promise<void> {
        this.readyPromise ??= this.init().catch((error) => {
            this.readyPromise = undefined;
            throw error;
        });
        return this.readyPromise;
    }

    private async init(): Promise<void> {
        if (!this.consumer) {
            this.consumer = new Consumer({
                batch: this.options.concurrency,
                queue: this.id,
                processor: this.responseHandler.bind(this),
                metadata: {
                    exclusive: true,
                },
            });
        }
        const available = await retryUntil(
            async () => ((await Producer().isExchangeAvailable(this.name)) ? true : undefined),
            { label: `rpc-exchange(${this.name})`, maxAttempts: this.options.timeout },
        );
        if (!available) throw new Error(`RPC exchange ${this.name} unavailable`);
        logger.info(`[Rpc] Exchange (${this.name}) is available`);
    }

    private responseHandler(msg: ConsumeMessage, channel: Channel): void {
        try {
            const content = msg.content.toString();
            const correlationId = msg.properties.correlationId;
            let response: unknown = content;
            try {
                response = JSON.parse(content);
            } catch {
                // not json; emit the raw string
            }
            this.emit(correlationId, response);
        } catch (error) {
            logger.error('[Rpc] responseHandler failed', { err: toError(error) });
        }
        // Responses are addressed to this ephemeral queue; requeueing a bad one can only loop.
        channel.ack(msg);
    }

    /**
     * Use this method if your consumer is configured to return response
     * @returns the object returned by consumer
     */
    public call(payload: unknown, routingKey: string = 'default'): Promise<unknown> {
        const correlationId = uuidv4();
        return new Promise((resolve, reject) => {
            const responseListener = (response: unknown) => {
                clearTimeout(timeoutRef);
                resolve(response);
            };
            const timeoutRef = setTimeout(() => {
                this.removeListener(correlationId, responseListener);
                reject(new Error('Request timed out'));
            }, 1000 * this.options.timeout);
            this.once(correlationId, responseListener);
            this.ready()
                .then(() => {
                    if (this.listenerCount(correlationId) === 0) return; // already timed out
                    return Producer().publish(this.name, payload, { replyTo: this.id, correlationId, routingKey });
                })
                .catch((error) => {
                    clearTimeout(timeoutRef);
                    this.removeListener(correlationId, responseListener);
                    reject(new Error(`Failed to send request: ${toError(error).message}`));
                });
        });
    }

    /**
     * Use this method if you don't want to wait for response or consumer don't return response
     * @returns true if published successfully and false if an error occurred
     */
    public async publish(payload: unknown, routingKey: string = 'default'): Promise<boolean> {
        try {
            await this.ready();
            return await Producer().publish(this.name, payload, { routingKey });
        } catch (error) {
            logger.error('[Rpc] Publish failed', { err: toError(error) });
            return false;
        }
    }
}

const instances = new Map<string, RpcClient>();

/** One client per (name, options) signature; all its calls share one exclusive reply queue. */
export const rpcClient = (name: string, options?: RpcOptions): RpcClient => {
    const signature = hash({ name, options: options ?? {} }, { algorithm: 'sha256' });
    let client = instances.get(signature);
    if (!client) {
        client = new RpcClient(name, options);
        instances.set(signature, client);
    }
    return client;
};
