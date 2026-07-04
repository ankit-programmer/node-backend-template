// TEMPLATE: demo service — shows the cache-aside (redis), RPC (rabbitmq), and Mongo write patterns in one place.
import { getMongo } from '../../config/mongo';
import { cget, cset } from '../../config/redis';
import { rpcClient } from '../../config/rpc';
import type { CreateExampleInput } from './example.schema';

const CACHE_TTL_SECONDS = 60;
const EXAMPLE_SERVICE = 'example_service';
const EXAMPLE_COLLECTION = 'examples';

/** Cache-aside read: redis first, RPC round-trip over RabbitMQ on a miss. */
export async function getExample(id: string): Promise<{ value: unknown; cached: boolean }> {
    const cacheKey = `example:${id}`;
    const hit = await cget(cacheKey);
    if (hit !== null) return { value: JSON.parse(hit), cached: true };
    const value = await rpcClient(EXAMPLE_SERVICE).call({ id });
    await cset(cacheKey, JSON.stringify(value), CACHE_TTL_SECONDS);
    return { value, cached: false };
}

/** Writes through to MongoDB and returns the stored document's id alongside the input. */
export async function createExample(input: CreateExampleInput): Promise<{ id: string } & CreateExampleInput> {
    const db = await getMongo().db();
    const result = await db.collection(EXAMPLE_COLLECTION).insertOne({ ...input, createdAt: new Date() });
    return { id: result.insertedId.toHexString(), ...input };
}
