const args = require('args-parser')(process.argv);

import { onShutdown, registerProcessHandlers } from '../lifecycle/shutdown';
import logger from '../logger';
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

registerProcessHandlers();
const consumer = new Consumer(selected);
onShutdown({ name: `consumer(${selected.queue})`, stage: 'intake', close: () => consumer.stop() });
