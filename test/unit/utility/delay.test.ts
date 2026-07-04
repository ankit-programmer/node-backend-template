import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { delay } from '../../../src/utility/delay';

describe('delay', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('resolves after the default 1000ms', async () => {
        const pending = delay();
        await vi.advanceTimersByTimeAsync(1000);
        await expect(pending).resolves.toBeUndefined();
    });

    it('does not resolve before the requested duration', async () => {
        const resolved = vi.fn();
        delay(500).then(resolved);
        await vi.advanceTimersByTimeAsync(499);
        expect(resolved).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(resolved).toHaveBeenCalled();
    });
});
