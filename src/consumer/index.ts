const args = require('args-parser')(process.argv);

import logger from '../logger';
import { delay } from '../utility';
import { batchConsumer } from './batch-testing';
import { Consumer, type IConsumer } from './consumer';
import { exampleConsumer } from './rpc-consumer';

const REGISTRY: Record<string, IConsumer> = {
    example: exampleConsumer,
    batch: batchConsumer,
};

const name: string = args?.consumer;
const selected = REGISTRY[name];
if (!selected) {
    logger.error(`Unknown consumer "${name}". Valid consumers: ${Object.keys(REGISTRY).join(', ')}`);
    process.exit(1);
}

const consumers = [new Consumer(selected)];

process.on('SIGINT', async () => {
    consumers.forEach((consumer) => consumer.stop());
    await delay(10000);
});

process.on('SIGTERM', async () => {
    consumers.forEach((consumer) => consumer.stop());
    await delay(10000);
});
