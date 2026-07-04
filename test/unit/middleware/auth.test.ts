import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testEnv = vi.hoisted(() => ({ values: {} as Record<string, string | undefined> }));

vi.mock('../../../src/config/env', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/config/env')>();
    return {
        ...actual,
        requireEnv: (key: string) => {
            const value = testEnv.values[key];
            if (value === undefined) throw new Error(`Environment variable ${key} is required but not set`);
            return value;
        },
    };
});

import { ApiError } from '../../../src/error/api-error';
import { AuthMethod, auth, type TokenData } from '../../../src/middleware/auth';

const JWT_SECRET = 'a-test-secret-of-sufficient-length';
const MASTER_API_KEY = 'test-master-key';

function makeReq(headers: Record<string, string> = {}): Request {
    return { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

function makeRes(): Response {
    return { locals: {} } as unknown as Response;
}

async function run(methods: AuthMethod[], req: Request, res: Response = makeRes()) {
    const next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
    await auth(methods)(req, res, next);
    return next;
}

describe('auth middleware', () => {
    beforeEach(() => {
        testEnv.values = { MASTER_API_KEY, JWT_SECRET };
    });

    it('NONE calls next() with no arguments', async () => {
        const next = await run([AuthMethod.NONE], makeReq());
        expect(next).toHaveBeenCalledWith();
    });

    describe('API key', () => {
        it('accepts a valid x-api-key header', async () => {
            const next = await run([AuthMethod.API_KEY], makeReq({ 'x-api-key': MASTER_API_KEY }));
            expect(next).toHaveBeenCalledWith();
        });

        it('rejects a missing key with 401', async () => {
            const next = await run([AuthMethod.API_KEY], makeReq());
            const error = next.mock.calls[0][0];
            expect(error).toBeInstanceOf(ApiError);
            expect(error.status).toBe(401);
        });

        it('rejects a wrong key with 401', async () => {
            const next = await run([AuthMethod.API_KEY], makeReq({ 'x-api-key': 'wrong' }));
            expect(next.mock.calls[0][0].status).toBe(401);
        });

        it('ignores the legacy apiKey query parameter', async () => {
            const req = { header: () => undefined, query: { apiKey: MASTER_API_KEY } } as unknown as Request;
            const next = await run([AuthMethod.API_KEY], req);
            expect(next.mock.calls[0][0]).toBeInstanceOf(ApiError);
        });

        it('never authenticates when MASTER_API_KEY is unset', async () => {
            testEnv.values.MASTER_API_KEY = undefined;
            const next = await run([AuthMethod.API_KEY], makeReq({ 'x-api-key': 'anything' }));
            expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
        });
    });

    describe('JWT token', () => {
        const payload: TokenData = {
            ip: '127.0.0.1',
            org: { id: 'org-1', name: 'Org' },
            user: { id: 'user-1', meta: '', email: 'user@example.com' },
            userEmail: 'user@example.com',
        };

        it('accepts a valid bearer token and exposes it on res.locals.user', async () => {
            const token = jwt.sign(payload, JWT_SECRET);
            const res = makeRes();
            const next = await run([AuthMethod.TOKEN], makeReq({ authorization: `Bearer ${token}` }), res);
            expect(next).toHaveBeenCalledWith();
            expect(res.locals.user).toMatchObject(payload);
        });

        it('rejects an expired token with 401', async () => {
            const token = jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 60 }, JWT_SECRET);
            const next = await run([AuthMethod.TOKEN], makeReq({ authorization: `Bearer ${token}` }));
            expect(next.mock.calls[0][0].status).toBe(401);
        });

        it('rejects a malformed token with 401', async () => {
            const next = await run([AuthMethod.TOKEN], makeReq({ authorization: 'Bearer not.a.jwt' }));
            expect(next.mock.calls[0][0].status).toBe(401);
        });

        it('rejects a token signed with the wrong secret', async () => {
            const token = jwt.sign(payload, 'some-other-secret-also-long-enough');
            const next = await run([AuthMethod.TOKEN], makeReq({ authorization: `Bearer ${token}` }));
            expect(next.mock.calls[0][0].status).toBe(401);
        });

        it('rejects a missing Authorization header with 401', async () => {
            const next = await run([AuthMethod.TOKEN], makeReq());
            expect(next.mock.calls[0][0].status).toBe(401);
        });
    });

    describe('method chaining', () => {
        it('falls through to the API key when the token fails', async () => {
            const next = await run(
                [AuthMethod.TOKEN, AuthMethod.API_KEY],
                makeReq({ authorization: 'Bearer bad', 'x-api-key': MASTER_API_KEY }),
            );
            expect(next).toHaveBeenCalledWith();
        });

        it('forwards the last failure when every method fails', async () => {
            const next = await run([AuthMethod.TOKEN, AuthMethod.API_KEY], makeReq());
            expect(next).toHaveBeenCalledTimes(1);
            expect(next.mock.calls[0][0].status).toBe(401);
        });

        it('rejects an empty method list', async () => {
            const next = await run([], makeReq());
            expect(next.mock.calls[0][0]).toBeInstanceOf(ApiError);
        });

        it('calls next exactly once even when the first method succeeds', async () => {
            const next = await run([AuthMethod.NONE, AuthMethod.API_KEY], makeReq());
            expect(next).toHaveBeenCalledTimes(1);
        });
    });
});
