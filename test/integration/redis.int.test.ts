import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Compressor } from '../../src/utility/compression';

const dockerAvailable = inject('dockerAvailable');

describe.skipIf(!dockerAvailable)('redis compressed cache', () => {
    let redis: typeof import('../../src/config/redis');

    beforeAll(async () => {
        process.env.REDIS_CONNECTION_STRING = inject('redisUrl');
        redis = await import('../../src/config/redis');
        const client = redis.getRedis();
        await new Promise<void>((resolve) => {
            if (client.isReady) return resolve();
            client.once('ready', () => resolve());
        });
    });

    afterAll(async () => {
        await redis.getRedis().close();
    });

    it.each([
        Compressor.SNAPPY,
        Compressor.GZIP,
        Compressor.BROTLI,
    ])('cset/cget round-trips a value with %s', async (lib) => {
        const key = `it:${lib}:${process.pid}`;
        await redis.cset(key, `value for ${lib}`, 60, lib);
        await expect(redis.cget(key, lib)).resolves.toBe(`value for ${lib}`);
    });

    it('cget returns null for a missing key', async () => {
        await expect(redis.cget(`it:missing:${process.pid}`)).resolves.toBeNull();
    });

    it('cset applies the TTL', async () => {
        const key = `it:ttl:${process.pid}`;
        await redis.cset(key, 'expiring', 120);
        const ttl = await redis.getRedis().ttl(key);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(120);
    });

    it('doesExist reflects key presence', async () => {
        const key = `it:exists:${process.pid}`;
        await expect(redis.doesExist(key)).resolves.toBe(false);
        await redis.cset(key, 'here', 60);
        await expect(redis.doesExist(key)).resolves.toBe(true);
    });

    it('readiness helper reports the connected client', () => {
        expect(redis.redisStatus()).toBe(true);
    });
});
