import cors from 'cors';
import express, { type Request, type Response } from 'express';
import env from './config/env';
import { AuthMethod, auth } from './middleware/auth';
import errorHandler from './middleware/error-handler';
import exampleRouter from './route/example/index';
import healthRouter from './route/health';
import { Service } from './service/rabbitmq/rpc';
import { APIResponseBuilder } from './utility';

export function createApp(): express.Express {
    const app = express();
    app.use(
        cors({
            origin: '*',
            maxAge: 86400,
            preflightContinue: true,
        }),
    );
    app.use(express.json({ limit: env.BODY_LIMIT }));
    app.use(express.urlencoded({ extended: true, limit: env.BODY_LIMIT }));

    app.get('/', (req: Request, res: Response) => {
        res.send('Hello, World!');
    });
    app.use('/health', healthRouter);
    app.use('/example', auth([AuthMethod.NONE]), exampleRouter);
    app.get('/rpc', async (req: Request, res: Response) => {
        const response = await Service('example_service').call({ id: req.params.id });
        res.json(new APIResponseBuilder().setSuccess(response).build());
    });

    app.use(errorHandler);
    return app;
}
