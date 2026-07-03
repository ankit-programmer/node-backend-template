import dotenv from 'dotenv';
dotenv.config();

const env = {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    QUEUE_CONNECTION_URL: process.env.QUEUE_CONNECTION_URL,
    REDIS_CONNECTION_STRING: process.env.REDIS_CONNECTION_STRING,
    MONGO_URI: process.env.MONGO_URI,
    RTLAYER_API_KEY: process.env.RTLAYER_API_KEY,
    MASTER_API_KEY: process.env.MASTER_API_KEY,
    SERVICE_NAME: process.env.SERVICE_NAME,
    LOG_LEVEL: process.env.LOG_LEVEL,
    JWT_SECRET: process.env.JWT_SECRET,
}

export default env;