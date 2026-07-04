import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// TEMPLATE: this mock targets the demo example module — repoint it at your first real module.
vi.mock('../../src/modules/example/example.service', () => ({
    getExample: vi.fn(async (id: string) => ({ value: { echo: id }, cached: false })),
    createExample: vi.fn(async (input: object) => ({ id: 'new-id', ...input })),
}));

import { createApp } from '../../src/app';

describe('app', () => {
    const app = createApp();

    it('serves liveness and readiness probes', async () => {
        const live = await request(app).get('/health/live');
        expect(live.status).toBe(200);
        expect(live.body).toEqual({ status: 'ok' });
        const ready = await request(app).get('/health/ready');
        expect(ready.status).toBe(200);
        expect(ready.body.status).toBe('ok');
    });

    it('answers CORS preflight requests directly', async () => {
        const res = await request(app)
            .options('/example/42')
            .set('Origin', 'http://client.example')
            .set('Access-Control-Request-Method', 'GET');
        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('returns the 404 envelope for unknown paths', async () => {
        const res = await request(app).get('/nope');
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: { message: 'Not Found' } });
    });

    it('rejects an unauthenticated module route with the error envelope', async () => {
        const res = await request(app).get('/example/42');
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ success: false, error: { message: expect.any(String) } });
    });

    it('turns malformed JSON bodies into a 400 error envelope, not an HTML stack trace', async () => {
        const res = await request(app).post('/example').set('Content-Type', 'application/json').send('{"broken json');
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, error: { message: expect.any(String) } });
    });
});
