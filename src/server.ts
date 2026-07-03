import env from './config/env';
import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { AuthMethod, auth } from './middleware/auth';
import errorHandler from './middleware/error-handler';
import exampleRouter from './route/example/index';
import searchRouter from './route/search/index';
import { Service } from './service/rabbitmq/rpc';
import { APIResponseBuilder } from './utility';
import producer from './config/producer';

const app = express();
const port = env.PORT || 3000;
app.use(cors({
    origin: "*",
    maxAge: 86400,
    preflightContinue: true,
}));
app.use(bodyParser.json({ limit: '8mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get('/', (req: Request, res: Response) => {
    res.send('Hello, World!');
});
app.use('/example', auth([AuthMethod.NONE]), exampleRouter);
app.use('/search', auth([AuthMethod.NONE]), searchRouter);
const vmService = Service('example_service', { timeout: 60 });
const otherService = Service('example_service', { timeout: 60 });
app.get('/rpc', async (req: Request, res: Response) => {
    const response = await vmService.call({});
    // const response = await producer.publishToQueue("agent", "testing");
    res.json(new APIResponseBuilder().setSuccess({ response }).build());
})

app.use(errorHandler as any);
// Start the server
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

/**
 * Script Request => Sync or RabbitMQ
 */