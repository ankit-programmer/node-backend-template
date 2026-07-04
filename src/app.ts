import express from 'express';
import { env } from './config/env';
import { errorHandler } from './middleware/error-handler';
import { notFound } from './middleware/not-found';
import { requestLogger } from './middleware/request-logger';
import { securityMiddleware } from './middleware/security';
import { exampleRouter } from './modules/example/example.route';
import { healthRouter } from './modules/health/health.route';

export function createApp(): express.Express {
    const app = express();
    app.use(securityMiddleware(env));
    app.use(express.json({ limit: env.BODY_LIMIT }));
    app.use(express.urlencoded({ extended: true, limit: env.BODY_LIMIT }));
    app.use(requestLogger());

    app.use('/health', healthRouter);
    app.use('/example', exampleRouter);

    app.use(notFound);
    app.use(errorHandler);
    return app;
}
