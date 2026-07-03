import { createApp } from './app';
import env from './config/env';
import logger from './logger';

const app = createApp();
app.listen(env.PORT, () => {
    logger.info(`Server is running at http://localhost:${env.PORT}`);
});
