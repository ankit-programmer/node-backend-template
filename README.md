# backend-template

TypeScript + Express 5 backend template with RabbitMQ (publish/consume, batching, RPC, transparent compression), Redis (compressed cache), MongoDB, structured logging, graceful shutdown, and health probes. Clone it, `npm ci`, and start building.

## Using this template

One-time checklist after cloning:

1. **Re-point the remote**: `git remote set-url origin <your-repo-url>`.
2. **Rename**: `name`, `description`, `author` (and reset `version`) in `package.json`; this README's title; the `SERVICE_NAME` default in `src/config/env.ts` and `.env.example`.
3. **Environment**: `cp .env.example .env` and fill in what you need. Never commit `.env`.
4. **Start dependencies**: `docker compose up -d` (RabbitMQ with a management UI on :15672, Redis, Mongo — ports match `.env.example`).
5. **Install & verify**: `npm install` (this also wires the git hooks), `npm run dev`, then `curl http://localhost:3000/health/live`.
6. **Prune the demo code**: run `git grep -n "TEMPLATE:"` and delete or replace every hit — the example module, the example/batch consumers and their REGISTRY entries, and their tests.
7. **Confirm green**: `npm test` (integration tests need Docker; they self-skip without it).
8. Delete this section.

## Quick start

```bash
npm ci
cp .env.example .env       # fill in the connections you need
docker compose up -d       # local RabbitMQ + Redis + Mongo
npm run dev                # HTTP server with reload
npm run dev-consumer       # example queue consumer (--consumer=example)
```

Every connection is lazy: modules connect on first use, so the server boots with only the env vars your code actually touches.

## Scripts

| Script                 | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | HTTP server with reload (`ts-node-dev`)                    |
| `npm run dev-consumer` | Example consumer with reload                               |
| `npm test`             | Unit tests + integration tests (integration self-skips without Docker) |
| `npm run test:unit`    | Fast unit suite only                                       |
| `npm run test:integration` | Real RabbitMQ/Redis via testcontainers (needs Docker)  |
| `npm run coverage`     | Unit suite with V8 coverage                                |
| `npm run typecheck`    | `tsc --noEmit` over src + tests                            |
| `npm run lint` / `lint:fix` | Biome check / auto-fix                                |
| `npm run build` / `start` / `start:consumer` | Compile and run from `dist/`         |

**Git hooks** (installed automatically by `npm install`): pre-commit runs Biome on staged files via lint-staged; pre-push runs the typecheck. Skip one-off with `git commit -n` / `git push --no-verify`.

## Environment

Validated with zod at startup (`src/config/env.ts`); invalid values fail fast with the offending variable named. Connection strings are only required by the modules that use them (`requireEnv` throws when a module is used without its variable).

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server |
| `NODE_ENV` | `development` | logger format, error detail exposure |
| `SERVICE_NAME` | `backend-template` | log metadata |
| `LOG_LEVEL` | `info` | winston |
| `LOG_TO_FILE` | `false` | adds a rotating file transport (containers should log to stdout) |
| `LOG_FILE_PATH` | `logs/app.log` | where the file transport writes |
| `QUEUE_CONNECTION_URL` | — | RabbitMQ producer/consumer/RPC |
| `REDIS_CONNECTION_STRING` | — | redis cache |
| `MONGO_URI` | — | MongoDB |
| `RTLAYER_API_KEY` | — | RTLayer client |
| `MASTER_API_KEY` | — | `AuthMethod.API_KEY` (header `x-api-key`) |
| `JWT_SECRET` | — | `AuthMethod.TOKEN` (`Authorization: Bearer`), min 16 chars |
| `HELMET_ENABLED` | `false` | security headers |
| `RATE_LIMIT_ENABLED` | `false` | rate limiting (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`) |
| `CORS_ORIGINS` | `*` | comma-separated allowlist, or `*` |
| `BODY_LIMIT` | `8mb` | JSON/urlencoded body size |
| `HTTP_TIMEOUT_MS` | `30000` | outbound `httpClient` (axios) |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | graceful-shutdown budget |
| `RPC_TIMEOUT_SEC` | `30` | default RPC call timeout |

**Hardening a deployment is an env change, not a code change:** set `HELMET_ENABLED=true`, `RATE_LIMIT_ENABLED=true`, and pin `CORS_ORIGINS` to your origins.

## Layout

```
src/
  app.ts                     express app assembly (createApp — no listen, supertest-ready)
  server.ts                  HTTP entry: listen + shutdown wiring
  modules/                   feature slices — one folder per feature
    example/                 demo slice: <feature>.route.ts / .service.ts / .schema.ts
    health/                  /health/live + /health/ready (route-only slice)
  config/                    env (zod) + lazy connection factories:
                             rabbitmq, redis, mongo, rpc, producer, axios, rtlayer, registry
  consumer/
    consumer.ts              Consumer + Batch framework
    index.ts                 worker entry (node dist/consumer/index.js --consumer=<name>)
    example.consumer.ts      demo RPC echo consumer
    batch-example.consumer.ts  demo aggregated (batched) consumer
  middleware/                auth (API key, JWT), security toggles, request logger,
                             not-found, error handler
  lifecycle/shutdown.ts      shutdown hooks + process-level error handlers
  error/api-error.ts         ApiError (message, HTTP status, optional details)
  logger/                    winston (dev printf / prod JSON), `{ err }` serialization
  utility/                   response envelope, toError, delay, retry/backoff,
                             compression, amqp helpers
test/
  unit/                      mocked, fast — runs everywhere; mirrors src/ paths
  integration/               real RabbitMQ/Redis via testcontainers — needs Docker
  setup/env-guard.ts         blocks real .env connection strings from ever reaching tests
```

## Conventions

The template has one way to do each thing — follow these and every module looks alike:

- **Feature slices** live in `src/modules/<feature>/` as `<feature>.route.ts` (HTTP: auth, zod parse, envelope), `<feature>.service.ts` (logic), `<feature>.schema.ts` (zod + inferred types). A file exists only when there's content — `health/` is route-only. Copy the `example` module to start a new feature.
- **Named exports only** — enforced by Biome (`noDefaultExport`), so imports look the same everywhere. `*.config.ts` files are exempt (their tools require default exports).
- **Response envelope** — `ok(data, meta?)` / `fail(message, details?)` from `src/utility/response.ts`; success is `{ success: true, data, meta? }`, errors are `{ success: false, error: { message, details? } }`. Validation failures return structured `details: [{ field, message }]`. The one exception: `/health/*` returns bare payloads because probes are machine consumers.
- **Errors** — throw `ApiError(message, status, details?)` for expected failures; everything else hits the global handler, which hides 5xx internals in production. No try/catch in route handlers: Express 5 forwards sync throws and async rejections (including zod `.parse`) to the error handler.
- **Logging** — `logger.error('[Component] what failed', { err: toError(error) })`. Bracketed PascalCase component prefixes; the logger serializes `err` into message + stack. Requests are logged at the `http` level by `middleware/request-logger.ts` (health probes excluded). No `console.*` (Biome warns) and no `any` (Biome errors).
- **Connections** — `mongo.ts` and `rabbitmq.ts` deliberately mirror each other (single-flight connect, capped retry, reconnect on abrupt close, graceful close); copy one to add a new managed connection, and reuse `connectionRegistry` for the per-connection-string singleton + shutdown hook + readiness plumbing. Redis and RTLayer stay simple module singletons — their clients manage themselves.

## RabbitMQ patterns

- **Publish** — `Producer().publish(exchange, payload, { routingKey, compressor })` or `publishToQueue(queue, payload, metadata)`. Publisher confirms with bounded retries; returns `boolean`.
- **Compression** — pass `compressor: Compressor.SNAPPY | GZIP | BROTLI`; consumers decompress transparently via the message's `contentEncoding`. Undecodable messages are rejected (`nack`, no requeue) by the framework before your processor runs.
- **Consume** — implement `IConsumer` and register it in `src/consumer/index.ts` (registry key == file base name == the `--consumer=<name>` argument). Processors own ack/nack for every decoded message; the framework never acks for you. Aggregated consumers (`aggregate.enabled`) receive arrays and always flush on a timer so messages never sit unacked.
- **RPC** — `rpcClient('exchange-name').call(payload)` resolves with the consumer's reply (correlation IDs + exclusive reply queue) or rejects on timeout.

All connections retry with linear backoff, reconnect on broker restarts, and close cleanly on SIGTERM/SIGINT.

## Health & lifecycle

- `GET /health/live` — process is up.
- `GET /health/ready` — 200/503 across the components this deployment has initialized (RabbitMQ/Redis/Mongo).
- Shutdown runs registered hooks (stop intake first, then close connections) inside `SHUTDOWN_TIMEOUT_MS`; `uncaughtException`/`unhandledRejection` log and exit through the same path.

## Testing

Unit tests mock the AMQP layer with explicit fakes (`test/helpers/fake-amqp.ts`). Integration tests start disposable RabbitMQ/Redis containers via testcontainers — deliberately not the docker-compose stack, so they never collide with your dev services or their leftover state. Locally they skip automatically when Docker isn't running; in CI they are mandatory. The suite covers compression round-trips, batching, RPC correlation and timeouts, and recovery from a broker restart.

A setup file (`test/setup/env-guard.ts`) blanks all connection strings and secrets before any test module loads, so a developer's `.env` can never leak real credentials into a test run — tests that need a broker inject their container URL explicitly.

## Docker

- **`docker-compose.yml`** runs local dependencies only (RabbitMQ + management UI, Redis, Mongo) with healthchecks; the app runs on the host via `npm run dev`.
- **`Dockerfile`** is the production image: multi-stage `node:22-slim` build, production-only dependencies, non-root `USER node`, container `HEALTHCHECK` against `/health/live`. Swap the `CMD` (see Dockerfile comment) to ship a consumer instead of the HTTP server.

## Breaking changes vs. earlier versions of this template

- **Response envelope changed**: `{ status, message, data, success }` (built by `APIResponseBuilder`) is now `ok()`/`fail()` — `{ success, data, meta? }` on success, `{ success: false, error: { message, details? } }` on failure. Zod issues arrive as structured `error.details`, not a JSON string in `message`.
- **`GET /rpc/:id` was absorbed into the example module** as `GET /example/:id` (API key + zod validation + redis cache in front of the RPC call). `GET /` (Hello World) was removed; unknown paths return an envelope 404.
- **Named exports everywhere**: `import { env }`, `{ logger }`, `{ getRabbit }`, `{ getMongo }`, `{ getRtLayer }`, `{ httpClient }`, `{ errorHandler }` replace the old default exports. The RPC factory `Service()` is now `rpcClient()` from `src/config/rpc.ts`.
- **`ApiError(message, status, details?)`** replaces `ApiError(message, code, type)`; the unused `Errors` enum is gone.
- **`Compressor`** (PascalCase enum) replaces `compressor`.
- **Consumer registry keys** are now file base names: `--consumer=example` (was `rpc-consumer.ts`) and `--consumer=batch-example` (was `batch-testing.ts`). `args-parser` was dropped.
- API keys are accepted from the `x-api-key` header only — the `?apiKey=` query parameter was removed (query strings leak into access logs).
- `AuthMethod.TOKEN` is implemented (JWT via `JWT_SECRET`) instead of throwing `Not Implemented`.
