import { type Request, type Response, Router } from 'express';
import { mongoStatus } from '../config/mongo';
import { rabbitStatus } from '../config/rabbitmq';
import { redisStatus } from '../config/redis';

const router = Router();

router.get('/live', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

router.get('/ready', (_req: Request, res: Response) => {
    const components = { rabbitmq: rabbitStatus(), redis: redisStatus(), mongo: mongoStatus() };
    const checks: Record<string, 'up' | 'down'> = {};
    let ready = true;
    for (const [name, up] of Object.entries(components)) {
        if (up === undefined) continue; // component not used by this deployment
        checks[name] = up ? 'up' : 'down';
        ready = ready && up;
    }
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'degraded', checks });
});

export default router;
