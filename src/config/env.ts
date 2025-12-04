import dotenv from 'dotenv';
dotenv.config();

const env = {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    QUEUE_CONNECTION_URL: process.env.QUEUE_CONNECTION_URL,
    REDIS_CONNECTION_STRING: process.env.REDIS_CONNECTION_STRING,
    MONGO_URI: process.env.MONGO_URI,
}

export default env;