import { crc32 } from 'crc';
import { createClient, RESP_TYPES } from 'redis';
import { onShutdown } from '../lifecycle/shutdown';
import { logger } from '../logger';
import { Compressor, compress, decompress } from '../utility/compression';
import { toError } from '../utility/error';
import { requireEnv } from './env';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

type RedisClient = ReturnType<typeof createClient>;

const MAX_RECONNECT_WAIT_MS = 30_000;

// Unlike mongo/rabbitmq there is no connectionRegistry here: node-redis manages its
// own reconnection, so a single module-level client is all the template needs.
let client: RedisClient | undefined;

export function getRedis(): RedisClient {
    if (!client) {
        client = createClient({
            url: requireEnv('REDIS_CONNECTION_STRING'),
            socket: {
                reconnectStrategy: (retries) => Math.min(retries * 1000, MAX_RECONNECT_WAIT_MS),
            },
        });
        client.on('ready', () => logger.info('[Redis] Connection established'));
        client.on('error', (error) => logger.error('[Redis] Connection error', { err: toError(error) }));
        client.connect().catch((error) => logger.error('[Redis] Failed to connect', { err: toError(error) }));
        const connected = client;
        onShutdown({ name: 'redis', close: () => connected.close() });
    }
    return client;
}

export function redisStatus(): boolean | undefined {
    if (!client) return undefined;
    return client.isReady;
}

export async function cget(key: string, lib: Compressor = Compressor.BROTLI): Promise<string | null> {
    const buffers = getRedis().withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
    const rawValue = await buffers.get(key);
    if (!rawValue) return null;
    return decompress(rawValue, lib);
}

export async function cset(
    key: string,
    value: string,
    ttlSecond: number = DEFAULT_TTL_SECONDS,
    lib: Compressor = Compressor.BROTLI,
): Promise<boolean> {
    const buffer = await compress(value, lib);
    await getRedis().set(key, buffer, { EX: ttlSecond });
    return true;
}

export async function doesExist(key: string): Promise<boolean> {
    const result = await getRedis().exists([key]);
    return result > 0;
}

/**
 * @param base Base Key Name
 * @param key Key you want to shard
 * @param totalElements Expected number of records to shard or store
 * @param shardSize Number of elements you want in a single shard
 */
export function shardKey(base: string, key: string, totalElements: number, shardSize: number): string {
    if (Number(key) && totalElements <= 0) {
        return `${base}:${Math.floor(parseInt(key, 10) / shardSize)}`;
    }
    const shards = Math.ceil(totalElements / shardSize);
    return `${base}:${crc32(key.toString()) % shards}`;
}
