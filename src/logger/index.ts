import { createLogger, format, transports } from 'winston';
import { env } from '../config/env';

const { timestamp, combine, printf, colorize } = format;

const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;

/** Convention: log failures as `logger.error('[Component] what failed', { err: toError(error) })`. */
const serializeErr = format((info) => {
    if (info.err instanceof Error) {
        info.err = { message: info.err.message, stack: info.err.stack };
    }
    return info;
});

function buildDevLogger(logLevel: string) {
    const localLogFormat = printf(({ level, message, timestamp, stack, err }) => {
        const errInfo = err as { stack?: string; message?: string } | undefined;
        const errText = errInfo ? `\n${errInfo.stack ?? errInfo.message ?? ''}` : '';
        return `${timestamp} ${level} ${message || ''} ${stack || ''}${errText}`;
    });

    return createLogger({
        level: logLevel,
        format: combine(
            colorize(),
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            format.errors({ stack: true }),
            serializeErr(),
            localLogFormat,
        ),
        defaultMeta: { service: env.SERVICE_NAME },
        transports: [new transports.Console()],
    });
}

function buildProdLogger(logLevel: string) {
    const logger = createLogger({
        level: logLevel,
        format: combine(timestamp(), format.errors({ stack: true }), serializeErr(), format.json()),
        defaultMeta: { service: env.SERVICE_NAME },
        transports: [new transports.Console()],
    });
    if (env.LOG_TO_FILE) {
        logger.add(
            new transports.File({
                filename: env.LOG_FILE_PATH,
                maxsize: MAX_LOG_FILE_BYTES,
                maxFiles: MAX_LOG_FILES,
            }),
        );
    }
    return logger;
}

export const logger = env.NODE_ENV === 'development' ? buildDevLogger(env.LOG_LEVEL) : buildProdLogger(env.LOG_LEVEL);
