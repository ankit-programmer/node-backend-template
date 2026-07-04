import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ZodError, z } from 'zod';
import { env } from '../../../src/config/env';
import { ApiError } from '../../../src/error/api-error';
import { errorHandler } from '../../../src/middleware/error-handler';

function makeRes() {
    return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

const req = {} as Request;
const next = vi.fn();

describe('errorHandler', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        next.mockClear();
    });

    it('responds with the ApiError status and message', () => {
        const res = makeRes();
        errorHandler(new ApiError('nope', 403), req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: { message: 'nope' } });
    });

    it('passes ApiError details through to the envelope', () => {
        const res = makeRes();
        errorHandler(new ApiError('bad input', 422, [{ field: 'a', message: 'Required' }]), req, res, next);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(res.json.mock.calls[0][0].error.details).toEqual([{ field: 'a', message: 'Required' }]);
    });

    it('responds 400 with structured details for a ZodError', () => {
        const res = makeRes();
        const result = z.object({ a: z.string(), b: z.number() }).safeParse({ a: 1, b: 'x' });
        errorHandler(result.error as ZodError, req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        const body = res.json.mock.calls[0][0];
        expect(body.error.message).toBe('Validation failed');
        expect(body.error.details).toHaveLength(2);
        expect(body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['a', 'b']);
    });

    it('responds 500 with the error message outside production', () => {
        const res = makeRes();
        errorHandler(new Error('database exploded'), req, res, next);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json.mock.calls[0][0].error.message).toBe('database exploded');
    });

    it('hides internals behind a generic message in production', () => {
        const res = makeRes();
        const envModule = env as { NODE_ENV: string };
        const original = envModule.NODE_ENV;
        envModule.NODE_ENV = 'production';
        try {
            errorHandler(new Error('database exploded'), req, res, next);
        } finally {
            envModule.NODE_ENV = original;
        }
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json.mock.calls[0][0].error.message).toBe('Internal Server Error');
    });

    it('never calls next (terminal handler)', () => {
        errorHandler(new Error('x'), req, makeRes(), next);
        expect(next).not.toHaveBeenCalled();
    });
});
