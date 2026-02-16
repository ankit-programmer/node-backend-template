import EventEmitter from 'events';
import producer from '../../config/producer';
import rabbitmqService, { Connection, Channel } from '../../config/rabbitmq';
import { Consumer } from '../../consumer';
import logger from "../../logger";
import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';
import { delay } from '../../utility';
import hash from 'object-hash';

interface Options {
    timeout?: number; // in seconds; default 30 seconds
    concurrency?: number; // number of concurrent responses to handle; default 20
}

class Service extends EventEmitter {
    private id: string;
    private name: string;
    private isExchangeAvailable: boolean = false;
    private consumer?: Consumer;
    private options: Options = {
        timeout: 30,
        concurrency: 20
    };
    constructor(name: string, options?: Options) {
        super();
        this.options = { ...this.options, ...options };
        this.id = `${name}-rpc-client-${nanoid(5)}`;
        this.name = name;
    }

    private async init() {
        // Setup a temprory queue to listen for responses
        this.consumer = new Consumer({
            batch: this.options.concurrency!,
            queue: this.id,
            processor: this.responseHandler.bind(this),
            metadata: {
                exclusive: true
            }
        });
        // Wait for exchange
        let retry = 0;
        while (!this.isExchangeAvailable) {
            this.isExchangeAvailable = await producer.isExchangeAvailable(this.name);
            if (this.isExchangeAvailable) {
                logger.info(`Exchange (${this.name}) is available.`);
                continue;
            };
            logger.info(`Waiting for the exchange(${this.name}) to be ready/created.`)
            retry = Math.min(++retry, 30);
            await delay(1000 * retry);
        }
    }
    private responseHandler(msg: any, channel: Channel) {
        try {
            const content = msg.content.toString();
            const correlationId = msg.properties.correlationId;
            let response = content;
            try {
                response = JSON.parse(content);
            } catch (error) {
                // not json
            }
            this.emit(correlationId, response);
            channel.ack(msg);
        } catch (error) {
            logger.error('[RPC Service] responseHandler', error);
            channel.ack(msg);
        }
    }
    /**
     * Use this method if your consumer is configured to return response
     * @param payload 
     * @param routingKey 
     * @returns the object returned by consumer
     */
    public call(payload: any, routingKey: string = "default"): Promise<any> {
        return new Promise(async (resolve, reject) => {
            if (!this.consumer) this.init(); // Initialize the service
            const correlationId = uuidv4();
            const responseListener = (response: any) => {
                clearTimeout(timeout);
                resolve(response);
            };
            this.once(correlationId, responseListener);
            const timeout = setTimeout(() => {
                this.removeListener(correlationId, responseListener);
                reject(new Error('Request timed out'));
            }, 1000 * this.options.timeout!);
            while (!this.isExchangeAvailable) {
                await delay(5000);
            }
            producer.publish(this.name, payload, { replyTo: this.id, correlationId, routingKey }).catch(error => {
                clearTimeout(timeout);
                this.removeListener(correlationId, responseListener);
                reject(new Error('Failed to send request: ' + error.message));
            });
        });
    }
    /**
     * Use this method if you don't want to wait for response or consumer don't return response
     * @param payload 
     * @param routingKey 
     * @returns true if published successfully and false if an error occurred
     */
    public async publish(payload: any, routingKey: string = "default"): Promise<boolean> {
        if (!this.consumer) this.init();
        while (!this.isExchangeAvailable) {
            await delay(1000);
        }
        return await producer.publish(this.name, payload, { routingKey }).then(() => true).catch((error) => {
            logger.error(error);
            return false
        });
    }
}
const instance = new Map<string, Service>();
const RPC = (name: string, options: Options): Service => {
    const signature = hash({ name, options }, { algorithm: 'sha256' });
    if (!instance.has(signature)) instance.set(signature, new Service(name, options));
    return instance.get(signature) as Service;
}

export {
    RPC as Service
}


