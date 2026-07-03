# backend-template

TypeScript + Express 5 backend template with RabbitMQ (publish/consume, batching, RPC, transparent compression), Redis (compressed cache), MongoDB, structured logging, graceful shutdown, and health probes. Clone it, `npm ci`, and start building.

## Quick start

```bash
npm ci
cp .env.example .env       # fill in the connections you need
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

## Environment

Validated with zod at startup (`src/config/env.ts`); invalid values fail fast with the offending variable named. Connection strings are only required by the modules that use them.

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server |
| `NODE_ENV` | `development` | logger format, error detail exposure |
| `SERVICE_NAME` | `backend-template` | log metadata |
| `LOG_LEVEL` | `info` | winston |
| `LOG_TO_FILE` | `false` | adds a rotating `logs/app.log` transport (containers should log to stdout) |
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
| `HTTP_TIMEOUT_MS` | `30000` | outbound axios instance |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | graceful-shutdown budget |
| `RPC_TIMEOUT_SEC` | `30` | default RPC call timeout |

**Hardening a deployment is an env change, not a code change:** set `HELMET_ENABLED=true`, `RATE_LIMIT_ENABLED=true`, and pin `CORS_ORIGINS` to your origins.

## Layout

```
src/
  app.ts                 express app assembly (createApp — no listen, supertest-ready)
  server.ts              HTTP entry: listen + shutdown wiring
  config/                env (zod), lazy connection factories: rabbitmq, redis, mongo, axios, rtlayer, producer
  consumer/
    consumer.ts          Consumer + Batch framework
    index.ts             worker entry (node dist/consumer/index.js --consumer=<name>)
    rpc-consumer.ts      example echo consumer
    batch-testing.ts     example aggregated (batched) consumer
  service/rabbitmq/rpc.ts    request/response RPC over RabbitMQ
  middleware/            auth (API key, JWT), security toggles, error handler
  route/                 example router + /health/live + /health/ready
  lifecycle/shutdown.ts  shutdown hooks + process-level error handlers
  utility/               response builder, compression, retry/backoff, amqp helpers
test/
  unit/                  mocked, fast — runs everywhere
  integration/           real RabbitMQ/Redis via testcontainers — needs Docker
```

## RabbitMQ patterns

- **Publish** — `Producer().publish(exchange, payload, { routingKey, compressor })` or `publishToQueue(queue, payload, metadata)`. Publisher confirms with bounded retries; returns `boolean`.
- **Compression** — pass `compressor: 'snappy' | 'gzip' | 'brotli'`; consumers decompress transparently via the message's `contentEncoding`.
- **Consume** — implement `IConsumer` and register it in `src/consumer/index.ts`. Processors own ack/nack; the framework never acks for you. Aggregated consumers (`aggregate.enabled`) receive arrays and always flush on a timer so messages never sit unacked.
- **RPC** — `Service('exchange-name').call(payload)` resolves with the consumer's reply (correlation IDs + exclusive reply queue) or rejects on timeout.

All connections retry with linear backoff, reconnect on broker restarts, and close cleanly on SIGTERM/SIGINT.

## Health & lifecycle

- `GET /health/live` — process is up.
- `GET /health/ready` — 200/503 across the components this deployment has initialized (RabbitMQ/Redis/Mongo).
- Shutdown runs registered hooks (stop intake first, then close connections) inside `SHUTDOWN_TIMEOUT_MS`; `uncaughtException`/`unhandledRejection` log and exit through the same path.

## Testing

Unit tests mock the AMQP layer with explicit fakes (`test/helpers/fake-amqp.ts`). Integration tests start disposable RabbitMQ/Redis containers via testcontainers — locally they skip automatically when Docker isn't running; in CI they are mandatory. The suite covers compression round-trips, batching, RPC correlation and timeouts, and recovery from a broker restart.

## Docker

Multi-stage `node:22-slim` build, production-only dependencies, non-root `USER node`, container `HEALTHCHECK` against `/health/live`. Swap the `CMD` (see Dockerfile comment) to ship a consumer instead of the HTTP server.

## Breaking changes vs. earlier versions of this template

- API keys are accepted from the `x-api-key` header only — the `?apiKey=` query parameter was removed (query strings leak into access logs).
- `GET /rpc` is now `GET /rpc/:id`, requires an API key, and validates its params.
- `AuthMethod.TOKEN` is implemented (JWT via `JWT_SECRET`) instead of throwing `Not Implemented`.
