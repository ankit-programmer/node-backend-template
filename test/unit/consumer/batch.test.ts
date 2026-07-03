import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Batch } from '../../../src/consumer/consumer';

describe('Batch', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function collect(batch: Batch) {
        const batches: any[][] = [];
        batch.on('process', (messages: any[]) => batches.push(messages));
        return batches;
    }

    it('emits process with exactly size messages when size is reached', () => {
        const batch = new Batch(3);
        const batches = collect(batch);
        batch.push(1);
        batch.push(2);
        expect(batches).toHaveLength(0);
        batch.push(3);
        expect(batches).toEqual([[1, 2, 3]]);
    });

    it('keeps overflow messages queued after emitting a full batch', () => {
        const batch = new Batch(2);
        const batches = collect(batch);
        batch.push(1);
        batch.push(2);
        batch.push(3);
        expect(batches).toEqual([[1, 2]]);
        batch.push(4);
        expect(batches).toEqual([
            [1, 2],
            [3, 4],
        ]);
    });

    it('emits a partial batch after the timeout when size is not reached', async () => {
        const batch = new Batch(10, 5);
        const batches = collect(batch);
        batch.push('only');
        await vi.advanceTimersByTimeAsync(4999);
        expect(batches).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(batches).toEqual([['only']]);
    });

    it('reaching size cancels the pending timer (no duplicate emit)', async () => {
        const batch = new Batch(2, 5);
        const batches = collect(batch);
        batch.push(1);
        batch.push(2);
        expect(batches).toEqual([[1, 2]]);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(batches).toEqual([[1, 2]]);
    });

    it('never emits on time alone when no timeout is configured', async () => {
        const batch = new Batch(10);
        const batches = collect(batch);
        batch.push(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(batches).toHaveLength(0);
    });

    it('clear() empties the queue and cancels the pending timer', async () => {
        const batch = new Batch(10, 5);
        const batches = collect(batch);
        batch.push(1);
        batch.clear();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(batches).toHaveLength(0);
    });

    it('size 1 emits immediately for every push', () => {
        const batch = new Batch(1);
        const batches = collect(batch);
        batch.push('a');
        batch.push('b');
        expect(batches).toEqual([['a'], ['b']]);
    });

    it('a second push does not restart the timer window', async () => {
        const batch = new Batch(10, 5);
        const batches = collect(batch);
        batch.push(1);
        await vi.advanceTimersByTimeAsync(3000);
        batch.push(2); // must NOT reset the 5s window
        await vi.advanceTimersByTimeAsync(2000);
        expect(batches).toEqual([[1, 2]]);
    });
});
