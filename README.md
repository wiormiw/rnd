# RnD: Learning System & Remediation Engine

RnD stands for Research and Development or Randomized, depending on how you use it. It is a curriculum and flashcard system. You organise what you learn into topics with prerequisites, write flashcards for each topic, and review them on a schedule. Cards you get wrong turn into concrete practice tasks.

It runs locally with no AI models and no cloud services. The full design is in [docs/SPECS.md](docs/SPECS.md).

## What the app is today

RnD is a single HTTP API service. It has three parts that work together:

- **Curriculum.** Topics form a prerequisite graph. A topic stays locked until its direct prerequisites are mastered.
- **Flashcards.** Each topic holds flashcards. Each card has its own SM-2 review state.
- **Daily sprint.** A sprint picks the due cards from unlocked topics that fit a time budget. It uses a 0/1 knapsack, so it maximises urgency within the minutes you have.

A review with a score below 2 spawns a practice task for that card. The card is suspended until the task is completed, then it is due again straight away.

Memos are raw notes, each with a title and an optional body. A memo can link to a topic, and a card can cite the memo it came from. Cards are written by hand.

The engines are pure math. Nothing calls an AI model.

Planned next, not built: a Flutter mobile client, and import of Google Keep notes from Google Takeout.

What is running now:
- Topics with prerequisites, cycle detection, topological order and per-topic status
- Flashcards with SM-2 state, review logging and review history
- Daily sprint with a 0/1 knapsack over due, unlocked cards
- Remediation: low-score reviews spawn a practice task that suspends the card until completed
- Memo CRUD, optionally linked to a topic
- Liveness and readiness endpoints; readiness checks PostgreSQL and Redis
- Per-IP rate limiting with a Redis-backed token bucket (Lua script)
- Request IDs, structured JSON logs, and basic security headers on every response
- Graceful shutdown on `SIGTERM` / `SIGINT`

## Stack

- **Runtime:** Node.js 26+, TypeScript (ESM, NodeNext)
- **HTTP:** NestJS 12 on `@nestjs/platform-node` (native Node HTTP, no Express or Fastify)
- **Validation:** Zod 4, applied per parameter through a `ZodValidationPipe`
- **Database:** PostgreSQL with Drizzle ORM and postgres.js
- **Rate limiting:** Redis via node-redis
- **Logging:** pino
- **Health checks:** `@nestjs/terminus`
- **Tests:** Vitest and supertest, using `@nestjs/testing` with in-memory repositories (no services needed)
- **Local services:** Docker Compose (PostgreSQL and Redis)
- **Tooling:** oxlint, oxfmt, fallow (dead-code and complexity checks)

## Getting started

Requirements: Node.js 26+, pnpm 12, Docker.

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
| `pnpm test` | Run the test suite (no services needed; Redis and PostgreSQL integration tests are skipped) |
| `pnpm lint` | oxlint and type-check |
| `pnpm format` / `pnpm check` | Format sources / check formatting |
| `pnpm infra:up` / `infra:down` | Start / stop PostgreSQL and Redis |
| `pnpm db:generate` / `db:migrate` | Generate / apply database migrations |

## Testing

`pnpm test` runs the unit and HTTP tests against in-memory repositories. They need no services.

To run the Redis integration tests against a live instance:

```bash
REDIS_TEST_URL=redis://localhost:6379 pnpm test redis.integration
```

To run the PostgreSQL integration tests (the review lock, the prerequisite advisory lock, the one-pending-task index and the delete rules) against a migrated database:

```bash
pnpm infra:up
DB_URL=postgres://rnd:rnd@localhost:5432/rnd pnpm db:migrate
DB_TEST_URL=postgres://rnd:rnd@localhost:5432/rnd pnpm test db.integration
```

The tests create their own topics and delete them afterwards, so they are safe to run against the local development database.

## API

All routes are under `/api/v1` except the two `/health` probes, which stay at the root. Every request is rate limited except the probes.

| Method | Path | Notes |
| :--- | :--- | :--- |
| GET | `/health` | Liveness. Never touches dependencies. Not rate limited. |
| GET | `/health/ready` | Checks PostgreSQL and Redis. 200 if both answer, 503 with per-dependency detail otherwise. |
| POST | `/memos` | Create a memo. Body: `title` (1–200 chars), `body` (optional, up to 50,000), `topicId` (optional, must exist). 201. |
| GET | `/memos` | List, newest first. `limit` (1–100, default 20), `offset` (default 0). |
| GET | `/memos/:id` | Get one. 404 if missing. |
| PATCH | `/memos/:id` | Update one. `topicId: null` unlinks. 404 if missing. |
| DELETE | `/memos/:id` | Delete one. 204. |
| GET | `/topics/:id/memos` | Memos linked to a topic. Paginated. 404 if the topic is missing. |
| POST | `/topics` | Create a topic. Body: `title` (1–200 chars), `description` (optional, up to 10,000). 201. |
| GET | `/topics` | List topics with `prerequisiteIds`, `cardCount`, `mastered` and `unlocked`. Not paginated. |
| GET | `/topics/:id` | Get one with the same fields. 404 if missing. |
| PATCH | `/topics/:id` | Update `title` and/or `description`. At least one field required. 404 if missing. |
| DELETE | `/topics/:id` | Delete a topic and its cards. 204. 404 if missing. |
| PUT | `/topics/:id/prerequisites/:prerequisiteId` | Add a prerequisite. 204. 404 if either topic is missing. 409 with `details.cycle` if it would create a cycle (a self-edge is a cycle of length one). |
| DELETE | `/topics/:id/prerequisites/:prerequisiteId` | Remove a prerequisite. 204. 404 if the edge does not exist. |
| GET | `/curriculum/order` | All topics in topological order (prerequisites first). |
| POST | `/topics/:id/cards` | Create a card. Body: `front`, `back`, `memoId` (optional), `estimatedMinutes` (1–120, default 2), `priorityWeight` (>0 to 10, default 1). Scheduling fields are rejected. 201. 404 if the topic or memo is missing. |
| GET | `/topics/:id/cards` | Cards in a topic. Paginated. 404 if the topic is missing. |
| GET | `/cards/:id` | Get one. 404 if missing. |
| PATCH | `/cards/:id` | Update the content fields. Scheduling state cannot be set here. 404 if missing. |
| DELETE | `/cards/:id` | Delete one. 204. |
| POST | `/cards/:id/review` | Record a review. Body: `qualityScore` (0–5), `timeSpentSeconds` (0–86400). 200 with `card`, `nextReviewAt` and `actionItem` (the new practice task, or `null`). 409 while a practice task is pending. |
| GET | `/cards/:id/reviews` | Review history, newest first. Paginated. 404 if the card is missing. |
| GET | `/schedule/daily` | Today's sprint. `maxMinutes` (1–480, default 45). Returns `totalCards`, `allocatedMinutes` and `items`. |
| GET | `/action-items` | Practice tasks, newest first. `status` (`PENDING` or `DONE`, optional). Paginated. |
| POST | `/action-items/:id/complete` | Mark a practice task done. The card is due again immediately. 200. 404 if missing. 409 if already done. |

Errors share one shape: `{ code, message, details? }`. Validation failures return 400 with `details` as a list of `{ path, message }`. Business conflicts return 409. Unknown routes return 404 in the same shape, on any path (not only under `/api/v1`). Rate-limited responses return 429 with `Retry-After`.

## How it works

**Unlock rule.** A topic is unlocked when every direct prerequisite is mastered. A topic with no prerequisites is always unlocked.

**Mastery.** A topic is mastered when every card in it has `smRepetition >= 2` (passed twice in a row) and no card in it has a pending practice task. A topic with no cards counts as mastered, so an empty grouping topic never blocks anything.

**SM-2 (per card).** A review scores quality `q` from 0 to 5. The ease factor is updated on every review and never drops below 1.3. If `q < 3`, the card resets to repetition 0 and interval 1 day. If `q >= 3`, the interval is 1 day, then 6 days, then `round(interval × ease factor)`. A new card starts at interval 0, repetition 0, ease factor 2.5, and is due immediately.

**Remediation.** A review with `q < 2` creates one pending practice task for the card. While it is pending, the card is left out of the sprint and reviews of it return 409. Completing the task sets the card's `nextReviewAt` to now, so it comes back into rotation.

**Urgency.** `urgency = (max(0, days overdue) / max(interval, 1) + 1) × priorityWeight`. The `max(…, 1)` avoids dividing by zero for new cards.

**Daily sprint.** The candidates are cards that are due, not suspended, and in unlocked topics. The sprint is a 0/1 knapsack: it picks the set with the highest total urgency whose estimated minutes fit in `maxMinutes`. Only the 2,000 most urgent candidates are considered. The result is deterministic.

## Configuration

All settings are environment variables, validated at startup. `DB_URL` and `REDIS_URL` are required. An invalid or missing value stops the process with one line per problem. Blank values count as unset. `.env.example` lists every variable with its default and a short description. Durations are in seconds unless the name ends in `_MS`.

## Project layout

```
src/
  main.ts             Bootstrap: NestJS with the Node adapter, CORS, keep-alive, shutdown guard
  configure-app.ts    Settings shared by the server and the test app (global /api/v1 prefix)
  app.module.ts       Root module: wires modules, global exception filter and rate-limit guard, middleware
  config/             ConfigService: the validated environment, available everywhere
  lib/config.ts       Environment schema (Zod), combined from each module's own schema
  database/           PostgreSQL: Drizzle schema.ts, postgres.js client, DatabaseModule with startup ping and shutdown drain
  redis/              Redis: node-redis client, RedisModule, token-bucket rate limiter (Lua)
  engines/            Pure math, no NestJS and no I/O: sm2, urgency, knapsack, dag, mastery
  curriculum/         Topics and prerequisites: controller -> service -> repository
  cards/              Flashcards under a topic
  reviews/            Review recording (SM-2 update, review log, remediation trigger) and history
  schedule/           Daily sprint: due cards from unlocked topics, passed through the knapsack
  action-items/       Practice tasks created by low-score reviews
  memos/              Memo module: controller -> service -> repository
  health/             Liveness and readiness endpoints
  common/             Shared code: Result, AppError, clock.ts (injectable wall clock), logger, request
                      context, abort helpers, plus the exception filter, rate-limit guard, middleware and Zod pipe
  __test__/           Tests (engine unit tests, HTTP tests on in-memory repositories, Redis and PostgreSQL integration)
drizzle/              Generated SQL migrations
docs/SPECS.md         Technical specification
```

Layers: controllers call services, services call repositories, and only repositories touch the database. Services return `Result` values for expected failures, and `AllExceptionsFilter` maps them to HTTP responses. Engines take `now` as a parameter and never read the clock, so their tests are deterministic. Infrastructure modules start and stop their connections through NestJS lifecycle hooks, so shutdown order follows the module graph.
