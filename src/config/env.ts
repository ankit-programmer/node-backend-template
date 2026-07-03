import dotenv from 'dotenv';
dotenv.config();

const env = {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    QUEUE_CONNECTION_URL: process.env.QUEUE_CONNECTION_URL,
    REDIS_CONNECTION_STRING: process.env.REDIS_CONNECTION_STRING,
    MONGO_URI: process.env.MONGO_URI,
    TYPESENSE_HOST: process.env.TYPESENSE_HOST || 'localhost',
    TYPESENSE_PORT: process.env.TYPESENSE_PORT ? parseInt(process.env.TYPESENSE_PORT) : 8108,
    TYPESENSE_PROTOCOL: process.env.TYPESENSE_PROTOCOL || 'http',
    TYPESENSE_API_KEY: process.env.TYPESENSE_API_KEY || 'testing',
}

export default env;