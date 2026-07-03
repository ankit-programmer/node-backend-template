import env from '../config/env';
import logger from '../logger';

interface ShutdownHook {
    name: string;
    /** 'intake' hooks stop accepting new work (HTTP server, consumers) and run before 'connection' hooks. */
    stage?: 'intake' | 'connection';
    close: () => unknown | Promise<unknown>;
}

const hooks: ShutdownHook[] = [];
let shuttingDown = false;
let handlersRegistered = false;

export function onShutdown(hook: ShutdownHook): void {
    hooks.push(hook);
}

async function runHooks(): Promise<void> {
    const byStage = (stage: ShutdownHook['stage']) =>
        hooks.filter((hook) => (hook.stage ?? 'connection') === stage).reverse();
    for (const hook of [...byStage('intake'), ...byStage('connection')]) {
        try {
            await hook.close();
            logger.info(`[Shutdown] Closed ${hook.name}`);
        } catch (error) {
            logger.error(`[Shutdown] Failed to close ${hook.name}`, error);
        }
    }
}

export async function shutdown(exitCode: number): Promise<void> {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    logger.info('[Shutdown] Closing...');
    const deadline = setTimeout(() => {
        logger.error(`[Shutdown] Timed out after ${env.SHUTDOWN_TIMEOUT_MS}ms`);
        process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    await runHooks();
    clearTimeout(deadline);
    process.exit(exitCode);
}

export function registerProcessHandlers(): void {
    if (handlersRegistered) return;
    handlersRegistered = true;
    process.on('SIGINT', () => shutdown(0));
    process.on('SIGTERM', () => shutdown(0));
    process.on('uncaughtException', (error) => {
        logger.error('[Process] Uncaught exception', error);
        shutdown(1);
    });
    process.on('unhandledRejection', (reason) => {
        logger.error('[Process] Unhandled rejection', reason);
        shutdown(1);
    });
}
