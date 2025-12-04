import express from 'express';
import { APIResponseBuilder } from '../../utility';

const router = express.Router();

router.get('/example', async (req, res, next) => {
    try {
        res.json(new APIResponseBuilder().build());
    } catch (error) {
        next(error);
    }
});

export default router;
