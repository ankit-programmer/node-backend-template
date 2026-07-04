import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        pool: 'forks',
        coverage: {
            provider: 'v8',
            include: ['src/**'],
            exclude: ['src/server.ts', 'src/consumer/index.ts'],
        },
        projects: [
            {
                test: {
                    name: 'unit',
                    include: ['test/unit/**/*.test.ts'],
                    pool: 'forks',
                },
            },
            {
                test: {
                    name: 'integration',
                    include: ['test/integration/**/*.int.test.ts'],
                    globalSetup: ['test/integration/global-setup.ts'],
                    pool: 'forks',
                    fileParallelism: false,
                    testTimeout: 60_000,
                    hookTimeout: 240_000,
                },
            },
        ],
    },
});
