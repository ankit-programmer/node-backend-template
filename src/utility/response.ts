export interface ErrorDetail {
    field?: string;
    message: string;
}

export interface OkResponse<T> {
    success: true;
    data: T;
    meta?: Record<string, unknown>;
}

export interface FailResponse {
    success: false;
    error: {
        message: string;
        details?: ErrorDetail[];
    };
}

export type ApiResponse<T = unknown> = OkResponse<T> | FailResponse;

/** Success envelope; meta stays a sibling of data (pagination, cache flags, ...). */
export function ok<T>(data: T, meta?: Record<string, unknown>): OkResponse<T> {
    return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

/** Error envelope; details carries structured per-field issues (e.g. validation). */
export function fail(message: string, details?: ErrorDetail[]): FailResponse {
    return details === undefined
        ? { success: false, error: { message } }
        : { success: false, error: { message, details } };
}
