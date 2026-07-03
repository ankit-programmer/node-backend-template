import http from 'node:http';
import https from 'node:https';
import axios from 'axios';
import env from './env';

const axiosInstance = axios.create({
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: env.HTTP_TIMEOUT_MS,
});

export default axiosInstance;
