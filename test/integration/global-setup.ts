import { execSync } from 'node:child_process';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
    export interface ProvidedContext {
        dockerAvailable: boolean;
        rabbitUrl: string;
        redisUrl: string;
    }
}

function dockerAvailable(): boolean {
    try {
        execSync('docker info', { stdio: 'ignore', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

export default async function setup(project: TestProject) {
    if (!dockerAvailable()) {
        if (process.env.CI) throw new Error('Docker is required for integration tests in CI');
        console.warn('Docker is not available — integration tests will be skipped.');
        project.provide('dockerAvailable', false);
        project.provide('rabbitUrl', '');
        project.provide('redisUrl', '');
        return;
    }

    const containers: StartedTestContainer[] = [];
    const [rabbit, redis] = await Promise.all([
        new GenericContainer('rabbitmq:3-alpine')
            .withExposedPorts(5672)
            .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
            .start(),
        new GenericContainer('redis:7-alpine')
            .withExposedPorts(6379)
            .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
            .start(),
    ]);
    containers.push(rabbit, redis);

    project.provide('dockerAvailable', true);
    project.provide('rabbitUrl', `amqp://${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`);
    project.provide('redisUrl', `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`);

    return async () => {
        await Promise.all(containers.map((container) => container.stop()));
    };
}
