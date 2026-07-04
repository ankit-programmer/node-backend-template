import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import env from './config/env';
import { AuthMethod, auth } from './middleware/auth';
import errorHandler from './middleware/error-handler';
import { securityMiddleware } from './middleware/security';
import exampleRouter from './route/example/index';
import healthRouter from './route/health';
import { Service } from './service/rabbitmq/rpc';
import { APIResponseBuilder } from './utility';

const rpcParamsSchema = z.object({ id: z.string().min(1) });

export function createApp(): express.Express {
    const app = express();
    app.use(securityMiddleware(env));
    app.use(express.json({ limit: env.BODY_LIMIT }));
    app.use(express.urlencoded({ extended: true, limit: env.BODY_LIMIT }));

    app.get('/', (_req: Request, res: Response) => {
        res.send('Hello, World!');
    });
    app.use('/health', healthRouter);
    app.use('/example', auth([AuthMethod.NONE]), exampleRouter);
    app.get('/rpc/:id', auth([AuthMethod.API_KEY]), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = rpcParamsSchema.parse(req.params);
            const response = await Service('example_service').call({ id });
            res.json(new APIResponseBuilder().setSuccess(response).build());
        } catch (error) {
            next(error);
        }
    });

    app.use(errorHandler);
    return app;
}
