import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { ApiError } from '../error/api-error';
import { logger } from '../logger';
import { toError } from '../utility/error';
import { fail } from '../utility/response';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ApiError) {
        res.status(err.status).json(fail(err.message, err.details));
        return;
    }
    if (err instanceof ZodError) {
        const details = err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
        res.status(400).json(fail('Validation failed', details));
        return;
    }
    logger.error('[Http] Unhandled error', { err: toError(err) });
    const status = Number(err?.status ?? err?.statusCode) || 500;
    const exposeMessage = status < 500 || env.NODE_ENV !== 'production';
    const message = exposeMessage ? err.message || 'Internal Server Error' : 'Internal Server Error';
    res.status(status).json(fail(message));
};
