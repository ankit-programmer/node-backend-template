import EventEmitter from 'events';
import producer from '../../config/producer';
import rabbitmqService, { Connection, Channel } from '../../config/rabbitmq';
import { Consumer } from '../../consumer';
import logger from "../../logger";
import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';

interface Options {
    timeout?: number; // in seconds; default 30 seconds
    concurrency?: number; // number of concurrent responses to handle; default 20
}
export class Service extends EventEmitter {
    private id: string;
    private name: string;
    private consumer: Consumer;
    private options: Options = {
        timeout: 30000,
        concurrency: 20
    };
    constructor(name: string, options?: Options) {
        super();
        this.options = { ...this.options, ...options };
        this.id = `${name}-rpc-client-${nanoid(5)}`;
        this.name = name;
        // Setup a temprory queue to listen for responses
        this.consumer = new Consumer({
            batch: this.options.concurrency!,
            queue: this.id,
            processor: this.responseHandler.bind(this),
            metadata: {
                exclusive: true
            }
        });

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

    public call(payload: any): Promise<any> {
        return new Promise((resolve, reject) => {
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
            producer.publishToQueue(this.name, payload, { replyTo: this.id, correlationId }).catch(error => {
                clearTimeout(timeout);
                this.removeListener(correlationId, responseListener);
                reject(new Error('Failed to send request: ' + error.message));
            });
        });
    }
}