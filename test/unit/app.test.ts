import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const MASTER_API_KEY = 'app-test-master-key';

vi.mock('../../src/config/env', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/config/env')>();
    return {
        ...actual,
        requireEnv: (key: string) => {
            if (key === 'MASTER_API_KEY') return MASTER_API_KEY;
            throw new Error(`Environment variable ${key} is required but not set`);
        },
    };
});

vi.mock('../../src/service/rabbitmq/rpc', () => ({
    Service: () => ({
        call: async (payload: any) => ({ echo: payload }),
    }),
}));

import { createApp } from '../../src/app';

describe('app', () => {
    const app = createApp();

    it('boots and serves the root route', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toBe('Hello, World!');
    });

    it('serves liveness and readiness probes', async () => {
        const live = await request(app).get('/health/live');
        expect(live.status).toBe(200);
        expect(live.body).toEqual({ status: 'ok' });
        const ready = await request(app).get('/health/ready');
        expect(ready.status).toBe(200);
        expect(ready.body.status).toBe('ok');
    });

    it('serves the example router through AuthMethod.NONE', async () => {
        const res = await request(app).get('/example/example');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'success', success: true });
    });

    it('rejects /rpc/:id without an API key using the error envelope', async () => {
        const res = await request(app).get('/rpc/42');
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ status: 'error', success: false });
    });

    it('serves /rpc/:id with a valid API key', async () => {
        const res = await request(app).get('/rpc/42').set('x-api-key', MASTER_API_KEY);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ echo: { id: '42' } });
    });

    it('answers CORS preflight requests directly', async () => {
        const res = await request(app)
            .options('/example/example')
            .set('Origin', 'http://client.example')
            .set('Access-Control-Request-Method', 'GET');
        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('turns malformed JSON bodies into a 400 error envelope, not an HTML stack trace', async () => {
        const res = await request(app)
            .post('/example/example')
            .set('Content-Type', 'application/json')
            .send('{"broken json');
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ status: 'error', success: false });
    });
});
