# RnD: Learning System & Remediation Engine

RnD stands for Research and Development or Randomized, depending on how you use it. It is a flexible learning and remediation system built on daily memos, which can be stacked over time. It records what you learn, schedules reviews, and turns weak recall into concrete practice tasks.

It runs locally with no AI models and no cloud services. The full design is in [docs/SPECS.md](docs/SPECS.md).

## What the app is today

RnD is a single HTTP API service. Today it stores and manages **memos**: short notes, each with a title and an optional body, that you create, list, read, update and delete. Memos are the foundation the rest of the system is meant to build on.

The planned learning features are specified in `docs/SPECS.md` but not built yet:
- Curriculum graph with prerequisites
- SM-2 review engine
- Knapsack daily sprint scheduler
- Remediation pipeline (action items on low scores)

What is running now:
- Memo CRUD over HTTP, with validated input and paginated listing
- Liveness and readiness endpoints; readiness checks PostgreSQL and Redis
- Per-IP rate limiting with a Redis-backed token bucket (Lua script)
- Request IDs, structured JSON logs, and basic security headers on every response
- Graceful shutdown on `SIGTERM` / `SIGINT`

## Stack

- **Runtime:** Node.js 22+, TypeScript (ESM, NodeNext)
- **HTTP:** NestJS 12 on `@nestjs/platform-node` (native Node HTTP, no Express or Fastify)
- **Validation:** Zod 4, applied per parameter through a `ZodValidationPipe`
- **Database:** PostgreSQL with Drizzle ORM and postgres.js
- **Cache and rate limiting:** Redis via node-redis
- **Logging:** pino
- **Health checks:** `@nestjs/terminus`
- **Tests:** Vitest and supertest, using `@nestjs/testing` with in-memory repositories (no services needed)
- **Local services:** Docker Compose (PostgreSQL and Redis)
- **Tooling:** oxlint, oxfmt, fallow (dead-code and complexity checks)

## Getting started

Requirements: Node.js 22+, pnpm 12, Docker.

```bash
pnpm install
cp .env.example .env     # DB_URL and REDIS_URL are required; everything else has a default
pnpm infra:up            # start PostgreSQL and Redis
pnpm db:migrate          # apply migrations
pnpm dev                 # run with reload
```

Stop the local services with `pnpm infra:down`.

## Scripts

| Script | What it does |
| :--- | :--- |
| `pnpm dev` | Run the server with reload |
| `pnpm build` / `pnpm start` | Compile to `dist/` and run it |
| `pnpm test` | Run the test suite (no services needed; Redis integration tests are skipped) |
| `pnpm lint` | oxlint and type-check |
| `pnpm format` / `pnpm check` | Format sources / check formatting |
| `pnpm infra:up` / `infra:down` | Start / stop PostgreSQL and Redis |
| `pnpm db:generate` / `db:migrate` | Generate / apply database migrations |

To run the Redis integration tests against a live instance:

```bash
REDIS_TEST_URL=redis://localhost:6379 pnpm test redis.integration
```

## API

| Method | Path | Notes |
| :--- | :--- | :--- |
| GET | `/health` | Liveness. Never touches dependencies. Not rate limited. |
| GET | `/health/ready` | Checks PostgreSQL and Redis. 200 if both answer, 503 with per-dependency detail otherwise. |
| POST | `/memos` | Create a memo. Body: `title` (1–200 chars), `body` (optional, up to 50,000 chars). Returns 201. |
| GET | `/memos` | List, newest first. `?limit=` (1–100, default 20) and `?offset=` (default 0). |
| GET | `/memos/:id` | Get one. |
| PATCH | `/memos/:id` | Update one. |
| DELETE | `/memos/:id` | Delete one. Returns 204. |

Errors share one shape: `{ code, message, details? }`. Validation failures return 400 with field paths in `details`. Rate-limited responses return 429 with `Retry-After`.

## Configuration

All settings are environment variables, validated at startup. An invalid or missing value stops the process with one line per problem. Blank values count as unset. `.env.example` lists every variable with its default and a short description. Durations are in seconds unless the name ends in `_MS`.

## Project layout

```
src/
  main.ts             Bootstrap: NestJS with the Node adapter, CORS, keep-alive, shutdown guard
  app.module.ts       Root module: wires modules, global exception filter and rate-limit guard, middleware
  config/             ConfigService: the validated environment, available everywhere
  lib/config.ts       Environment schema (Zod), combined from each module's own schema
  database/           PostgreSQL: Drizzle schema, postgres.js client, DatabaseModule with startup ping and shutdown drain
  redis/              Redis: node-redis client, RedisModule, token-bucket rate limiter (Lua)
  health/             Liveness and readiness endpoints
  memos/              Memo module: controller -> service -> repository
  common/             Shared code: Result, AppError, logger, request context, abort helpers,
                      plus the exception filter, rate-limit guard, middleware and Zod pipe
  __test__/           Tests
drizzle/              Generated SQL migrations
docs/SPECS.md         Technical specification
```

Layers: controllers call services, services call repositories, and only repositories touch the database. Services return `Result` values for expected failures, and `AllExceptionsFilter` maps them to HTTP responses. Infrastructure modules start and stop their connections through NestJS lifecycle hooks, so shutdown order follows the module graph.
