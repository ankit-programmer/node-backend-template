import { createLogger, format, transports } from 'winston';
import env from '../config/env';

const { timestamp, combine, printf, colorize } = format;

const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;

function buildDevLogger(logLevel: string) {
    const localLogFormat = printf(({ level, message, timestamp, stack }: any) => {
        return `${timestamp} ${level} ${message || ''} ${stack || ''}`;
    });

    return createLogger({
        level: logLevel,
        format: combine(
            colorize(),
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            format.errors({ stack: true }),
            localLogFormat,
        ),
        defaultMeta: { service: env.SERVICE_NAME },
        transports: [new transports.Console()],
    });
}

function buildProdLogger(logLevel: string) {
    const logger = createLogger({
        level: logLevel,
        format: combine(timestamp(), format.errors({ stack: true }), format.json()),
        defaultMeta: { service: env.SERVICE_NAME },
        transports: [new transports.Console()],
    });
    if (env.LOG_TO_FILE) {
        logger.add(new transports.File({ filename: 'logs/app.log', maxsize: MAX_LOG_FILE_BYTES, maxFiles: MAX_LOG_FILES }));
    }
    return logger;
}

export default env.NODE_ENV === 'development' ? buildDevLogger(env.LOG_LEVEL) : buildProdLogger(env.LOG_LEVEL);
