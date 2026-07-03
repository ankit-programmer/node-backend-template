import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import env from '../config/env';
import { ApiError } from '../error/api-error';
import logger from '../logger';
import { APIResponseBuilder } from '../utility';

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    const responseBuilder = new APIResponseBuilder();
    if (err instanceof ApiError) {
        res.status(err.code).json(responseBuilder.setError(err.message, err.code).build());
        return;
    }
    if (err instanceof ZodError) {
        const issues = err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
        res.status(400).json(responseBuilder.setError(JSON.stringify(issues), 400).build());
        return;
    }
    logger.error(err);
    const message = env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message || 'Internal Server Error';
    res.status(500).json(responseBuilder.setError(message, 500).build());
};

export default errorHandler;
