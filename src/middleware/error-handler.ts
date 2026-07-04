import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import env from '../config/env';
import { ApiError } from '../error/api-error';
import logger from '../logger';
import { APIResponseBuilder } from '../utility';

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const responseBuilder = new APIResponseBuilder();
    if (err instanceof ApiError) {
        res.status(err.code).json(responseBuilder.setError(err.message).build());
        return;
    }
    if (err instanceof ZodError) {
        const issues = err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
        res.status(400).json(responseBuilder.setError(JSON.stringify(issues)).build());
        return;
    }
    logger.error(err);
    const status = Number(err?.status ?? err?.statusCode) || 500;
    const exposeMessage = status < 500 || env.NODE_ENV !== 'production';
    const message = exposeMessage ? err.message || 'Internal Server Error' : 'Internal Server Error';
    res.status(status).json(responseBuilder.setError(message).build());
};

export default errorHandler;
