import { onShutdown, registerProcessHandlers } from '../lifecycle/shutdown';
import { logger } from '../logger';
import { batchExampleConsumer } from './batch-example.consumer';
import { Consumer, type IConsumer } from './consumer';
import { exampleConsumer } from './example.consumer';

// Registry key == consumer file base name == the --consumer=<name> CLI argument.
const REGISTRY: Record<string, IConsumer> = {
    // TEMPLATE: demo consumers — replace these entries with your own.
    example: exampleConsumer,
    'batch-example': batchExampleConsumer,
};

const name = process.argv.find((arg) => arg.startsWith('--consumer='))?.split('=')[1] ?? '';
const selected = REGISTRY[name];
if (!selected) {
    logger.error(`Unknown consumer "${name}". Valid consumers: ${Object.keys(REGISTRY).join(', ')}`);
    process.exit(1);
}

registerProcessHandlers();
const consumer = new Consumer(selected);
onShutdown({ name: `consumer(${selected.queue})`, stage: 'intake', close: () => consumer.stop() });
