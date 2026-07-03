import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { requireEnv } from '../config/env';
import { ApiError, Errors } from '../error/api-error';

export enum AuthMethod {
    TOKEN = 'token',
    API_KEY = 'apiKey',
    NONE = 'none',
}

export interface TokenData {
    ip: string;
    org: {
        id: string;
        name: string;
    };
    user: {
        id: string;
        meta: string;
        email: string;
    };
    userEmail: string;
}

declare global {
    namespace Express {
        interface Locals {
            user?: TokenData;
        }
    }
}

type Authenticator = (req: Request, res: Response) => void | Promise<void>;

const authenticators: Record<AuthMethod, Authenticator> = {
    [AuthMethod.NONE]: () => undefined,
    [AuthMethod.API_KEY]: apiKeyAuth,
    [AuthMethod.TOKEN]: tokenAuth,
};

/** Tries each method in order; the first to succeed wins, otherwise the last failure is forwarded. */
export function auth(authMethods: AuthMethod[] = [AuthMethod.API_KEY]) {
    return async (req: Request, res: Response, next: NextFunction) => {
        let lastError: unknown;
        for (const method of authMethods) {
            const authenticate = authenticators[method];
            if (!authenticate) {
                lastError = new ApiError(`Unknown auth method: ${method}`, 401, Errors.Authentication);
                continue;
            }
            try {
                await authenticate(req, res);
                return next();
            } catch (error) {
                lastError = error;
            }
        }
        next(
            lastError ??
                new ApiError('Authentication failed. Please authenticate yourself.', 401, Errors.Authentication),
        );
    };
}

function tokenAuth(req: Request, res: Response): void {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) throw new ApiError('Missing bearer token', 401, Errors.Authentication);
    const secret = requireEnv('JWT_SECRET');
    try {
        res.locals.user = jwt.verify(token, secret) as TokenData;
    } catch {
        throw new ApiError('Invalid or expired token', 401, Errors.Authentication);
    }
}

function apiKeyAuth(req: Request): void {
    const apiKey = req.header('x-api-key');
    if (!apiKey || !timingSafeEqual(apiKey, requireEnv('MASTER_API_KEY'))) {
        throw new ApiError('Invalid API key', 401, Errors.Authentication);
    }
}

function timingSafeEqual(a: string, b: string): boolean {
    const digestA = crypto.createHash('sha256').update(a).digest();
    const digestB = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(digestA, digestB);
}
