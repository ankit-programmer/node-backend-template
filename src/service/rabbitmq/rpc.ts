import EventEmitter from 'node:events';
import { nanoid } from 'nanoid';
import hash from 'object-hash';
import { v4 as uuidv4 } from 'uuid';
import env from '../../config/env';
import { Producer } from '../../config/producer';
import type { Channel } from '../../config/rabbitmq';
import { Consumer } from '../../consumer/consumer';
import logger from '../../logger';
import { retryUntil } from '../../utility/backoff';

interface Options {
    timeout?: number; // in seconds
    concurrency?: number; // number of concurrent responses to handle; default 20
}

const EXTRA_LISTENER_HEADROOM = 10;

class Service extends EventEmitter {
    private id: string;
    private name: string;
    private consumer?: Consumer;
    private readyPromise?: Promise<void>;
    private options: Required<Options>;

    constructor(name: string, options?: Options) {
        super();
        this.options = { timeout: env.RPC_TIMEOUT_SEC, concurrency: 20, ...options };
        this.setMaxListeners(this.options.concurrency + EXTRA_LISTENER_HEADROOM);
        this.id = `${name}-rpc-client-${nanoid(5)}`;
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
        logger.info(`Exchange (${this.name}) is available.`);
    }

    private responseHandler(msg: any, channel: Channel) {
        try {
            const content = msg.content.toString();
            const correlationId = msg.properties.correlationId;
            let response = content;
            try {
                response = JSON.parse(content);
            } catch {
                // not json; emit the raw string
            }
            this.emit(correlationId, response);
        } catch (error) {
            logger.error('[RPC Service] responseHandler', error);
        }
        // Responses are addressed to this ephemeral queue; requeueing a bad one can only loop.
        channel.ack(msg);
    }

    /**
     * Use this method if your consumer is configured to return response
     * @returns the object returned by consumer
     */
    public call(payload: any, routingKey: string = 'default'): Promise<any> {
        const correlationId = uuidv4();
        return new Promise((resolve, reject) => {
            const responseListener = (response: any) => {
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
                    reject(new Error(`Failed to send request: ${error.message}`));
                });
        });
    }

    /**
     * Use this method if you don't want to wait for response or consumer don't return response
     * @returns true if published successfully and false if an error occurred
     */
    public async publish(payload: any, routingKey: string = 'default'): Promise<boolean> {
        try {
            await this.ready();
            return await Producer().publish(this.name, payload, { routingKey });
        } catch (error) {
            logger.error(error);
            return false;
        }
    }
}

const instance = new Map<string, Service>();
const RPC = (name: string, options?: Options): Service => {
    const signature = hash({ name, options: options ?? {} }, { algorithm: 'sha256' });
    if (!instance.has(signature)) instance.set(signature, new Service(name, options));
    return instance.get(signature) as Service;
};

export { RPC as Service };
