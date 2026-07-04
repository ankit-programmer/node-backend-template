/**
 * Safety guard: runs in every Vitest worker BEFORE any test module (and its
 * transitive src imports) loads. The developer's local .env may contain real
 * connection strings; dotenv never overrides keys that already exist on
 * process.env, and loadEnv treats blank values as unset — so pre-seeding ''
 * both blocks .env and neutralizes shell-inherited values. Tests that need a
 * broker assign a container URL in beforeAll before dynamically importing src.
 */
const GUARDED = [
    'QUEUE_CONNECTION_URL',
    'REDIS_CONNECTION_STRING',
    'MONGO_URI',
    'RTLAYER_API_KEY',
    'MASTER_API_KEY',
    'JWT_SECRET',
] as const;

for (const key of GUARDED) {
    process.env[key] = '';
}
process.env.NODE_ENV = 'test';
