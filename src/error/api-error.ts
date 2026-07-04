export class ApiError extends Error {
    readonly code: number;
    readonly type?: Errors;

    constructor(message: string, code: number, type?: Errors) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.type = type;
    }
}

export enum Errors {
    Authorization = 'Authorization',
    Authentication = 'Authentication',
    InvalidRequest = 'Invalid Request',
}
