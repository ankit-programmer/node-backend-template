export function delay(time = 1000) {
    return new Promise((resolve) => {
        setTimeout(() => {
            return resolve(true);
        }, time)
    });
}

type StatusMessage = 'success' | 'error';
export class APIResponseBuilder {
    private status: StatusMessage;
    private isSuccess: boolean;
    private message: any;
    private data: any;
    private code: number;

    constructor() {
        this.status = 'success';
        this.code = 200;
        this.message = null;
        this.isSuccess = true;
        this.data = null;
    }

    setMeta(meta: any) {
        this.data = {
            ...this.data,
            meta,
        };
        return this;
    }
    setSuccess(data?: object, code: number = 200) {
        this.code = code;
        if (typeof data === 'object' && !Array.isArray(data) && data !== null) {
            this.data = data;
        } else {
            throw new Error('Data must be undefined or an object');
        }
        this.isSuccess = true;
        return this;

    }
    setError(message: string, code: number = 400) {
        if (typeof message !== 'string') {
            throw new Error('Message must be a string');
        }
        this.code = code;
        this.message = message;
        this.status = 'error';
        this.isSuccess = false;
        return this;
    }
    build() {

        return {
            status: this.status,
            message: this.message,
            data: this.data,
            success: this.isSuccess
        };
    }
}