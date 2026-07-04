import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retryUntil } from '../../../src/utility/backoff';

describe('retryUntil', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('returns immediately when the first attempt succeeds, without waiting', async () => {
        const attempt = vi.fn(async () => 'value');
        const result = await retryUntil(attempt, { label: 'test' });
        expect(result).toBe('value');
        expect(attempt).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('waits baseMs * attemptNo between attempts, capped at maxMs', async () => {
        const attempt = vi.fn(async () => undefined);
        const pending = retryUntil(attempt, { label: 'test', baseMs: 1000, maxMs: 2000, maxAttempts: 4 });
        expect(attempt).toHaveBeenCalledTimes(1); // attempt-first: no delay before the first try
        await vi.advanceTimersByTimeAsync(1000); // wait 1: 1000ms
        expect(attempt).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(2000); // wait 2: min(2000, 2000)
        expect(attempt).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(2000); // wait 3: capped at 2000
        expect(attempt).toHaveBeenCalledTimes(4);
        await expect(pending).resolves.toBeUndefined();
    });

    it('stops after maxAttempts and resolves undefined', async () => {
        const attempt = vi.fn(async () => undefined);
        const pending = retryUntil(attempt, { label: 'test', baseMs: 10, maxAttempts: 3 });
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toBeUndefined();
        expect(attempt).toHaveBeenCalledTimes(3);
    });

    it('returns the value from a later successful attempt', async () => {
        let calls = 0;
        const attempt = vi.fn(async () => (++calls === 3 ? 'late' : undefined));
        const pending = retryUntil(attempt, { label: 'test', baseMs: 10 });
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toBe('late');
    });

    it('honors shouldStop before attempting', async () => {
        const attempt = vi.fn(async () => 'value');
        const result = await retryUntil(attempt, { label: 'test', shouldStop: () => true });
        expect(result).toBeUndefined();
        expect(attempt).not.toHaveBeenCalled();
    });

    it('stops retrying once shouldStop flips', async () => {
        let stop = false;
        const attempt = vi.fn(async () => {
            stop = true;
            return undefined;
        });
        const pending = retryUntil(attempt, { label: 'test', baseMs: 10, shouldStop: () => stop });
        await vi.runAllTimersAsync();
        await expect(pending).resolves.toBeUndefined();
        expect(attempt).toHaveBeenCalledTimes(1);
    });
});
