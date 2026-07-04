import type { RequestHandler } from 'express';
import { logger } from '../logger';

const NANOS_PER_MILLI = 1e6;

/** Logs one line per request at the `http` level; health probes are skipped to keep noise down. */
export function requestLogger(): RequestHandler {
    return (req, res, next) => {
        if (req.path.startsWith('/health')) return next();
        const startedAt = process.hrtime.bigint();
        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / NANOS_PER_MILLI;
            logger.http(`${req.method} ${req.originalUrl} ${res.statusCode}`, {
                durationMs: Math.round(durationMs),
            });
        });
        next();
    };
}
