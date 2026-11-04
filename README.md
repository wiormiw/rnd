# RnD: Learning System & Remediation Engine

RnD stands for Research and Development or Randomized, depending on how you use it. It is a flexible learning and remediation system built on daily memos, which can be stacked over time. It records what you learn, schedules reviews, and turns weak recall into concrete practice tasks.

It runs locally with no AI models and no cloud services. It keeps a curriculum of topics with prerequisites, schedules reviews with the SuperMemo-2 algorithm, and picks a daily sprint that fits your time budget.

The full design is in [docs/SPECS.md](docs/SPECS.md).

## Status

Target design (specified, not all built yet):
- Curriculum graph with prerequisites
- SM-2 review engine
- Knapsack daily sprint scheduler
- Remediation pipeline (action items on low scores)

Built so far:
- Fastify server with validated config and graceful shutdown
- PostgreSQL via Drizzle and postgres.js, with a first migration
- Redis via node-redis
- Memo CRUD (`/memos`), a placeholder for the first real domain module
- Per-IP token-bucket rate limiting in Redis (Lua)
- Health endpoints: `/health` (liveness) and `/health/ready` (dependency checks)

## Stack

Node.js 22+, TypeScript, Fastify 5, Zod, PostgreSQL + Drizzle, Redis, Docker Compose for local services.

## Getting started

Requirements: Node.js 22+, pnpm 12, Docker.

```bash
pnpm install
cp .env.example .env     # only DB_URL and REDIS_URL are required, the rest have defaults
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
| `pnpm test` | Run the unit tests (no services needed) |
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
| GET | `/health` | Liveness. Not rate limited. |
| GET | `/health/ready` | Runs each dependency check. 503 if any fails. |
| POST | `/memos` | Create a memo. |
| GET | `/memos` | List, newest first. `?limit=` (1–100) and `?offset=`. |
| GET | `/memos/:id` | Get one. |
| DELETE | `/memos/:id` | Delete one. |

Errors share one shape: `{ code, message, details? }`. Rate-limited responses return 429 with `Retry-After`.

## Configuration

All settings are environment variables, validated at startup. `.env.example` lists them with their defaults and descriptions. Durations are in seconds unless the name ends in `_MS`.

## Project layout

```
src/
  app.ts              Fastify app factory (HTTP setup only)
  index.ts            Entry point: config, wiring, startup, shutdown
  infrastructure/     PostgreSQL and Redis clients, each a lifecycle resource
  modules/            Business logic: repository -> service -> routes
  plugins/            Fastify plugins (errors, request context, rate limit, ...)
  routes/             Health checks
  lib/                Shared utilities (config, errors, lifecycle, logger, Result)
  __test__/           Tests
docs/SPECS.md         Technical specification
```

Layers: routes call services, services call repositories, and only repositories touch the database. Services return `Result` values for expected failures, and the error plugin maps them to HTTP responses.
