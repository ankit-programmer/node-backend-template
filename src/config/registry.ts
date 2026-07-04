import { onShutdown } from '../lifecycle/shutdown';
import { logger } from '../logger';
import { toError } from '../utility/error';

/** The lifecycle surface a managed connection must expose to live in a registry. */
export interface ManagedConnection {
    connect(): Promise<void>;
    closeConnection(): Promise<void>;
    status(): boolean;
}

export interface ConnectionRegistry<T extends ManagedConnection> {
    /** Returns the connection for this connection string, creating (and eagerly connecting) it on first use. */
    get(connectionString: string): T;
    /** undefined when no connection was ever requested (component unused), otherwise true only if all are up. */
    status(): boolean | undefined;
}

/** One instance per connection string; the first `get` starts connecting and registers a shutdown hook. */
export function connectionRegistry<T extends ManagedConnection>(
    name: string,
    create: (connectionString: string) => T,
): ConnectionRegistry<T> {
    const instances = new Map<string, T>();
    return {
        get(connectionString: string): T {
            let instance = instances.get(connectionString);
            if (!instance) {
                instance = create(connectionString);
                instances.set(connectionString, instance);
                const created = instance;
                created.connect().catch((error) => {
                    logger.error(`[Registry] Failed to connect ${name}`, { err: toError(error) });
                });
                onShutdown({ name, close: () => created.closeConnection() });
            }
            return instance;
        },
        status(): boolean | undefined {
            if (instances.size === 0) return undefined;
            return [...instances.values()].every((instance) => instance.status());
        },
    };
}
