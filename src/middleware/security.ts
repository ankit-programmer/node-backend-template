import cors from 'cors';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Env } from '../config/env';

const CORS_MAX_AGE_SECONDS = 86400;

export function securityMiddleware(env: Env): RequestHandler[] {
    const middleware: RequestHandler[] = [];
    if (env.HELMET_ENABLED) middleware.push(helmet());
    if (env.RATE_LIMIT_ENABLED) {
        middleware.push(
            rateLimit({
                windowMs: env.RATE_LIMIT_WINDOW_MS,
                limit: env.RATE_LIMIT_MAX,
                standardHeaders: true,
                legacyHeaders: false,
            }),
        );
    }
    middleware.push(cors(buildCorsOptions(env)));
    return middleware;
}

function buildCorsOptions(env: Env): cors.CorsOptions {
    if (env.CORS_ORIGINS === '*') return { origin: '*', maxAge: CORS_MAX_AGE_SECONDS };
    const allowlist = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
    return { origin: allowlist, maxAge: CORS_MAX_AGE_SECONDS };
}
