import { crc32 } from 'crc';
import { createClient, RESP_TYPES } from 'redis';
import logger from '../logger';
import { compress, compressor, decompress } from '../utility/compression';
import { requireEnv } from './env';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

type RedisClient = ReturnType<typeof createClient>;

let client: RedisClient | undefined;

export function getRedis(): RedisClient {
    if (!client) {
        client = createClient({
            url: requireEnv('REDIS_CONNECTION_STRING'),
            socket: {
                reconnectStrategy: (retries) => retries * 1000,
            },
        });
        client.on('ready', () => logger.info('Connection Established to Redis!'));
        client.on('error', (error) => logger.error(error));
        client.connect().catch((error) => logger.error('[REDIS] Failed to connect', error));
    }
    return client;
}

export async function cget(key: string, lib: compressor = compressor.BROTLI): Promise<string | null> {
    const buffers = getRedis().withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
    const rawValue = await buffers.get(key);
    if (!rawValue) return null;
    return decompress(rawValue, lib);
}

export async function cset(
    key: string,
    value: string,
    ttlSecond: number = DEFAULT_TTL_SECONDS,
    lib: compressor = compressor.BROTLI,
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
