import axios from 'axios';
import http from 'http';
import https from 'https';
import env from './env';

const axiosInstance = axios.create({
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
    timeout: env.HTTP_TIMEOUT_MS,
});

export default axiosInstance;
