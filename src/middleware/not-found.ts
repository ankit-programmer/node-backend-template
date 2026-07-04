import type { RequestHandler } from 'express';
import { fail } from '../utility/response';

/** Envelope-consistent 404 instead of Express's default HTML page. */
export const notFound: RequestHandler = (_req, res) => {
    res.status(404).json(fail('Not Found'));
};
