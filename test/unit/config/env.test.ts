import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../../src/config/env';

describe('loadEnv', () => {
    it('returns defaults for an empty environment', () => {
        const env = loadEnv({});
        expect(env.NODE_ENV).toBe('development');
        expect(env.PORT).toBe(3000);
        expect(env.SERVICE_NAME).toBe('backend-template');
        expect(env.LOG_LEVEL).toBe('info');
        expect(env.HELMET_ENABLED).toBe(false);
        expect(env.RATE_LIMIT_ENABLED).toBe(false);
        expect(env.CORS_ORIGINS).toBe('*');
        expect(env.BODY_LIMIT).toBe('8mb');
        expect(env.QUEUE_CONNECTION_URL).toBeUndefined();
    });

    it('coerces PORT to a number', () => {
        expect(loadEnv({ PORT: '8080' }).PORT).toBe(8080);
    });

    it('rejects a non-numeric PORT', () => {
        expect(() => loadEnv({ PORT: 'not-a-port' })).toThrow(/PORT/);
    });

    it('rejects an unknown NODE_ENV', () => {
        expect(() => loadEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    });

    it('parses booleanish toggles', () => {
        expect(loadEnv({ HELMET_ENABLED: 'true' }).HELMET_ENABLED).toBe(true);
        expect(loadEnv({ HELMET_ENABLED: '1' }).HELMET_ENABLED).toBe(true);
        expect(loadEnv({ HELMET_ENABLED: 'false' }).HELMET_ENABLED).toBe(false);
        expect(loadEnv({ HELMET_ENABLED: '0' }).HELMET_ENABLED).toBe(false);
    });

    it('treats blank values as unset', () => {
        expect(loadEnv({ JWT_SECRET: '' }).JWT_SECRET).toBeUndefined();
        expect(loadEnv({ PORT: '' }).PORT).toBe(3000);
    });

    it('rejects a JWT_SECRET shorter than 16 characters', () => {
        expect(() => loadEnv({ JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    });

    it('passes connection strings through untouched', () => {
        const env = loadEnv({ QUEUE_CONNECTION_URL: 'amqp://localhost:5672' });
        expect(env.QUEUE_CONNECTION_URL).toBe('amqp://localhost:5672');
    });

    it('names every offending variable in the error message', () => {
        expect(() => loadEnv({ PORT: 'x', RATE_LIMIT_MAX: 'y' })).toThrow(/PORT.*RATE_LIMIT_MAX|RATE_LIMIT_MAX.*PORT/);
    });
});
