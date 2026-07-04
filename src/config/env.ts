import dotenv from 'dotenv';
import { z } from 'zod';

// Under Vitest the local .env (which may hold real connection strings) must
// never leak into tests; test/setup/env-guard.ts pre-seeds the guarded vars.
if (!process.env.VITEST) {
    dotenv.config();
}

const booleanish = z
    .enum(['true', 'false', '1', '0'])
    .transform((value) => value === 'true' || value === '1')
    .default(false);

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    SERVICE_NAME: z.string().default('backend-template'),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
    LOG_TO_FILE: booleanish,
    LOG_FILE_PATH: z.string().default('logs/app.log'),

    QUEUE_CONNECTION_URL: z.string().optional(),
    REDIS_CONNECTION_STRING: z.string().optional(),
    MONGO_URI: z.string().optional(),
    RTLAYER_API_KEY: z.string().optional(),

    MASTER_API_KEY: z.string().optional(),
    JWT_SECRET: z.string().min(16).optional(),

    HELMET_ENABLED: booleanish,
    RATE_LIMIT_ENABLED: booleanish,
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    CORS_ORIGINS: z.string().default('*'),
    BODY_LIMIT: z.string().default('8mb'),

    HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    RPC_TIMEOUT_SEC: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
    const withoutBlanks = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
    const parsed = envSchema.safeParse(withoutBlanks);
    if (!parsed.success) {
        const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        throw new Error(`Invalid environment: ${details}`);
    }
    return parsed.data;
}

export const env = loadEnv();

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
    const value = env[key];
    if (value === undefined) {
        throw new Error(`Environment variable ${key} is required but not set`);
    }
    return value as NonNullable<Env[K]>;
}
