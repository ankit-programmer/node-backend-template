import { createApp } from './app';
import { env } from './config/env';
import { onShutdown, registerProcessHandlers } from './lifecycle/shutdown';
import { logger } from './logger';

registerProcessHandlers();

const server = createApp().listen(env.PORT, () => {
    logger.info(`Server is running at http://localhost:${env.PORT}`);
});

onShutdown({
    name: 'http-server',
    stage: 'intake',
    close: () =>
        new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeIdleConnections();
        }),
});
