import type { ErrorDetail } from '../utility/response';

export class ApiError extends Error {
    readonly status: number;
    readonly details?: ErrorDetail[];

    constructor(message: string, status = 500, details?: ErrorDetail[]) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.details = details;
    }
}
