import { logger } from '../logger';
import { delay } from './delay';

export interface RetryOptions {
    label: string;
    baseMs?: number;
    maxMs?: number;
    maxAttempts?: number;
    shouldStop?: () => boolean;
}

/** Runs attempt() until it returns a value, waiting min(maxMs, baseMs * attemptNo) between tries. */
export async function retryUntil<T>(
    attempt: () => Promise<T | undefined>,
    { label, baseMs = 1000, maxMs = 30_000, maxAttempts = Number.POSITIVE_INFINITY, shouldStop }: RetryOptions,
): Promise<T | undefined> {
    for (let attemptNo = 1; !shouldStop?.(); attemptNo++) {
        const result = await attempt();
        if (result !== undefined) return result;
        if (attemptNo >= maxAttempts) break;
        const waitMs = Math.min(maxMs, baseMs * attemptNo);
        logger.info(`[Retry] ${label}: attempt ${attemptNo} failed, retrying in ${waitMs}ms`);
        await delay(waitMs);
    }
    return undefined;
}
