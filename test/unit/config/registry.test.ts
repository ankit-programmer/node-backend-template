import { describe, expect, it, vi } from 'vitest';
import { connectionRegistry, type ManagedConnection } from '../../../src/config/registry';

type FakeConnection = ManagedConnection & {
    connect: ReturnType<typeof vi.fn>;
    closeConnection: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
};

function makeFake(up = true): FakeConnection {
    return {
        connect: vi.fn(async () => undefined),
        closeConnection: vi.fn(async () => undefined),
        status: vi.fn(() => up),
    };
}

describe('connectionRegistry', () => {
    it('creates one instance per connection string and memoizes it', () => {
        const created: FakeConnection[] = [];
        const registry = connectionRegistry('thing', () => {
            const fake = makeFake();
            created.push(fake);
            return fake;
        });
        const a = registry.get('conn://a');
        const b = registry.get('conn://a');
        const c = registry.get('conn://b');
        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(created).toHaveLength(2);
    });

    it('eagerly connects exactly once per instance', () => {
        const registry = connectionRegistry('thing', () => makeFake());
        const instance = registry.get('conn://a') as FakeConnection;
        registry.get('conn://a');
        expect(instance.connect).toHaveBeenCalledTimes(1);
    });

    it('reports undefined status before any connection is requested', () => {
        const registry = connectionRegistry('thing', () => makeFake());
        expect(registry.status()).toBeUndefined();
    });

    it('reports true only when every connection is up', () => {
        const byString: Record<string, FakeConnection> = {
            'conn://up': makeFake(true),
            'conn://down': makeFake(false),
        };
        const registry = connectionRegistry('thing', (connectionString) => byString[connectionString]);
        registry.get('conn://up');
        expect(registry.status()).toBe(true);
        registry.get('conn://down');
        expect(registry.status()).toBe(false);
    });

    it('survives a rejected eager connect without unhandled rejection', async () => {
        const fake = makeFake();
        fake.connect.mockRejectedValue(new Error('refused'));
        const registry = connectionRegistry('thing', () => fake);
        expect(() => registry.get('conn://a')).not.toThrow();
        await new Promise((resolve) => setImmediate(resolve));
    });
});
