import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIResponseBuilder, delay } from '../../../src/utility';

describe('delay', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('resolves after the default 1000ms', async () => {
        const pending = delay();
        await vi.advanceTimersByTimeAsync(1000);
        await expect(pending).resolves.toBe(true);
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

describe('APIResponseBuilder', () => {
    it('builds the default success envelope', () => {
        expect(new APIResponseBuilder().build()).toEqual({
            status: 'success',
            message: null,
            data: null,
            success: true,
        });
    });

    it('setSuccess stores object data and chains', () => {
        const builder = new APIResponseBuilder();
        expect(builder.setSuccess({ a: 1 })).toBe(builder);
        expect(builder.build().data).toEqual({ a: 1 });
    });

    it('setSuccess accepts undefined without throwing', () => {
        expect(new APIResponseBuilder().setSuccess().build().success).toBe(true);
    });

    it('setSuccess rejects arrays and null', () => {
        expect(() => new APIResponseBuilder().setSuccess([1, 2] as any)).toThrow();
        expect(() => new APIResponseBuilder().setSuccess(null as any)).toThrow();
    });

    it('setError sets the error envelope and chains', () => {
        const builder = new APIResponseBuilder();
        expect(builder.setError('boom')).toBe(builder);
        expect(builder.build()).toEqual({ status: 'error', message: 'boom', data: null, success: false });
    });

    it('setError rejects non-string messages', () => {
        expect(() => new APIResponseBuilder().setError(42 as any)).toThrow();
    });

    it('setMeta merges meta into existing data', () => {
        const built = new APIResponseBuilder().setSuccess({ a: 1 }).setMeta({ page: 2 }).build();
        expect(built.data).toEqual({ a: 1, meta: { page: 2 } });
    });

    it('build output exposes exactly the envelope fields', () => {
        expect(Object.keys(new APIResponseBuilder().build()).sort()).toEqual(
            ['data', 'message', 'status', 'success'].sort(),
        );
    });
});
