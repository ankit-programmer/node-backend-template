export function delay(time = 1000) {
    return new Promise((resolve) => {
        setTimeout(() => {
            return resolve(true);
        }, time);
    });
}

type StatusMessage = 'success' | 'error';

export class APIResponseBuilder {
    private status: StatusMessage;
    private isSuccess: boolean;
    private message: any;
    private data: any;

    constructor() {
        this.status = 'success';
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

    setSuccess(data?: object) {
        if (data !== undefined) {
            if (typeof data !== 'object' || Array.isArray(data) || data === null) {
                throw new Error('Data must be undefined or an object');
            }
            this.data = data;
        }
        this.status = 'success';
        this.isSuccess = true;
        return this;
    }

    setError(message: string) {
        if (typeof message !== 'string') {
            throw new Error('Message must be a string');
        }
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
            success: this.isSuccess,
        };
    }
}
