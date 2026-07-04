import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const statuses = vi.hoisted(() => ({
    rabbit: undefined as boolean | undefined,
    redis: undefined as boolean | undefined,
    mongo: undefined as boolean | undefined,
}));

vi.mock('../../../../src/config/rabbitmq', () => ({ rabbitStatus: () => statuses.rabbit }));
vi.mock('../../../../src/config/redis', () => ({ redisStatus: () => statuses.redis }));
vi.mock('../../../../src/config/mongo', () => ({ mongoStatus: () => statuses.mongo }));

import { healthRouter } from '../../../../src/modules/health/health.route';

const app = express().use('/health', healthRouter);

describe('health routes', () => {
    beforeEach(() => {
        statuses.rabbit = undefined;
        statuses.redis = undefined;
        statuses.mongo = undefined;
    });

    it('GET /health/live always returns ok', async () => {
        const res = await request(app).get('/health/live');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok' });
    });

    it('GET /health/ready skips components that were never initialized', async () => {
        const res = await request(app).get('/health/ready');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'ok', checks: {} });
    });

    it('reports initialized components as up and stays ready', async () => {
        statuses.rabbit = true;
        const res = await request(app).get('/health/ready');
        expect(res.status).toBe(200);
        expect(res.body.checks).toEqual({ rabbitmq: 'up' });
    });

    it('degrades with a 503 when any initialized component is down', async () => {
        statuses.rabbit = true;
        statuses.redis = false;
        const res = await request(app).get('/health/ready');
        expect(res.status).toBe(503);
        expect(res.body).toMatchObject({ status: 'degraded', checks: { rabbitmq: 'up', redis: 'down' } });
    });
});
