import { Router } from 'express';
import { mongoStatus } from '../../config/mongo';
import { rabbitStatus } from '../../config/rabbitmq';
import { redisStatus } from '../../config/redis';

export const healthRouter = Router();

// Deliberately outside the ok()/fail() envelope: liveness/readiness probes are
// machine consumers (k8s, Docker HEALTHCHECK) that expect bare payloads.
healthRouter.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
});

healthRouter.get('/ready', (_req, res) => {
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
