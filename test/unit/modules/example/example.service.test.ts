// TEMPLATE: tests for the demo example module — delete with src/modules/example.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    cache: new Map<string, string>(),
    cget: vi.fn(async (key: string): Promise<string | null> => mocks.cache.get(key) ?? null),
    cset: vi.fn(async (key: string, value: string) => {
        mocks.cache.set(key, value);
        return true;
    }),
    call: vi.fn(async (payload: unknown) => ({ answer: payload })),
    insertOne: vi.fn(async () => ({ insertedId: { toHexString: () => 'abc123' } })),
}));

vi.mock('../../../../src/config/redis', () => ({ cget: mocks.cget, cset: mocks.cset }));
vi.mock('../../../../src/config/rpc', () => ({ rpcClient: () => ({ call: mocks.call }) }));
vi.mock('../../../../src/config/mongo', () => ({
    getMongo: () => ({
        db: async () => ({ collection: () => ({ insertOne: mocks.insertOne }) }),
    }),
}));

import { createExample, getExample } from '../../../../src/modules/example/example.service';

describe('getExample', () => {
    beforeEach(() => {
        mocks.cache.clear();
        mocks.cget.mockClear();
        mocks.cset.mockClear();
        mocks.call.mockClear();
    });

    it('fetches over RPC and populates the cache on a miss', async () => {
        const result = await getExample('42');
        expect(result).toEqual({ value: { answer: { id: '42' } }, cached: false });
        expect(mocks.call).toHaveBeenCalledWith({ id: '42' });
        expect(mocks.cset).toHaveBeenCalledTimes(1);
    });

    it('serves the second read from cache without another RPC call', async () => {
        await getExample('42');
        const second = await getExample('42');
        expect(second).toEqual({ value: { answer: { id: '42' } }, cached: true });
        expect(mocks.call).toHaveBeenCalledTimes(1);
    });
});

describe('createExample', () => {
    it('inserts into Mongo and returns the new id alongside the input', async () => {
        const created = await createExample({ name: 'demo' });
        expect(mocks.insertOne).toHaveBeenCalledWith(expect.objectContaining({ name: 'demo' }));
        expect(created).toEqual({ id: 'abc123', name: 'demo' });
    });
});
