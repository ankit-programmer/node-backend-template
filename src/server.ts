import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { AuthMethod, auth } from './middleware/auth';
import errorHandler from './middleware/error-handler';
import env from './config/env';
import exampleRouter from './route/example/index';

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

app.use(errorHandler as any);
// Start the server
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});