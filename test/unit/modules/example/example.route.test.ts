// TEMPLATE: tests for the demo example module — delete with src/modules/example.
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const MASTER_API_KEY = 'route-test-master-key';

vi.mock('../../../../src/config/env', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/config/env')>();
    return {
        ...actual,
        requireEnv: (key: string) => {
            if (key === 'MASTER_API_KEY') return MASTER_API_KEY;
            throw new Error(`Environment variable ${key} is required but not set`);
        },
    };
});

vi.mock('../../../../src/modules/example/example.service', () => ({
    getExample: vi.fn(async (id: string) => ({ value: { echo: id }, cached: false })),
    createExample: vi.fn(async (input: object) => ({ id: 'new-id', ...input })),
}));

import { errorHandler } from '../../../../src/middleware/error-handler';
import { exampleRouter } from '../../../../src/modules/example/example.route';

const app = express().use(express.json()).use('/example', exampleRouter).use(errorHandler);

describe('example routes', () => {
    it('GET /example/:id returns the ok envelope with cache meta', async () => {
        const res = await request(app).get('/example/42').set('x-api-key', MASTER_API_KEY);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: { echo: '42' }, meta: { cached: false } });
    });

    it('rejects a missing API key with the error envelope', async () => {
        const res = await request(app).get('/example/42');
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ success: false, error: { message: expect.any(String) } });
    });

    it('POST /example validates the body and returns 201 with the ok envelope', async () => {
        const res = await request(app).post('/example').set('x-api-key', MASTER_API_KEY).send({ name: 'demo' });
        expect(res.status).toBe(201);
        expect(res.body).toEqual({ success: true, data: { id: 'new-id', name: 'demo' } });
    });

    it('rejects an invalid body with structured validation details', async () => {
        const res = await request(app).post('/example').set('x-api-key', MASTER_API_KEY).send({});
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('Validation failed');
        expect(res.body.error.details[0]).toMatchObject({ field: 'name' });
    });
});
