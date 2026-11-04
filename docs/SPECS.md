# Technical Specification: Learning System & Remediation Engine (RnD)

This document defines the system architecture, database schema, mathematical engines, caching strategy, and API boundaries for the local learning and spaced-repetition system.

---

## 1. System Overview

The system operates locally without artificial intelligence models or cloud services. It uses explicit algorithms and relational state machines to manage learning curricula, track memory retention, schedule study sprints, and convert failed recall events into concrete remediation tasks.

### Core Objectives
- **Curriculum DAG:** Enforce prerequisite dependencies and prevent circular references across learning topics.
- **SM-2 Engine:** Calculate memory retention intervals and ease factors based on explicit user quality scores.
- **Knapsack Scheduler:** Select high-priority review items deterministically to fit within a time limit.
- **Remediation Pipeline:** Automatically generate practice tasks when a review score falls below the threshold.

---

## 2. Technology Stack Specification

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime & Server** | Node.js / Fastify | HTTP server, fast routing, schema validation integration |
| **Validation** | Zod | End-to-end type inference, request payload and query validation |
| **Database & ORM** | PostgreSQL + Drizzle ORM | Relational state management powered by `postgres.js` driver |
| **Cache & Locks** | Redis (`node-redis`) | Ephemeral sprint cache, graph state memoization, execution locks |
| **Observability** | Standard Console / Local Logs | Lightweight internal stdout logging (No telemetry overhead) |

---

## 3. Database Schema (`schema.ts`)

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  real,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

// 1. Knowledge Nodes (Core items & SM-2 state)
export const knowledgeNodes = pgTable(
  'knowledge_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 255 }).notNull(),
    category: varchar('category', { length: 50 }).notNull(), // 'concept' | 'code_spike' | 'architecture'
    content: text('content'),
    estimatedMinutes: integer('estimated_minutes').notNull().default(15),
    priorityWeight: real('priority_weight').notNull().default(1.0),
    
    // SM-2 Spaced Repetition Algorithm State
    smInterval: integer('sm_interval').notNull().default(1),
    smRepetition: integer('sm_repetition').notNull().default(0),
    smEaseFactor: real('sm_ease_factor').notNull().default(2.5),
    nextReviewAt: timestamp('next_review_at', { mode: 'date', withTimezone: true }).notNull(),
    
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    nextReviewIdx: index('idx_nodes_next_review').on(table.nextReviewAt),
    priorityIdx: index('idx_nodes_priority').on(table.priorityWeight),
  })
);

// 2. Node Prerequisites (Self-referential DAG Edges)
export const nodePrerequisites = pgTable(
  'node_prerequisites',
  {
    parentNodeId: uuid('parent_node_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
    childNodeId: uuid('child_node_id')
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.parentNodeId, table.childNodeId] }),
  })
);

// 3. Revision Logs (Append-only review audit)
export const revisionLogs = pgTable('revision_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
  qualityScore: integer('quality_score').notNull(), // Range: 0 to 5
  timeSpentMinutes: integer('time_spent_minutes').notNull(),
  previousInterval: integer('previous_interval').notNull(),
  newInterval: integer('new_interval').notNull(),
  previousEaseFactor: real('previous_ease_factor').notNull(),
  newEaseFactor: real('new_ease_factor').notNull(),
  reviewedAt: timestamp('reviewed_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
});

// 4. Action Items (Remediation pipeline output)
export const actionItems = pgTable('action_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => knowledgeNodes.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // 'PENDING' | 'DONE'
  spawnedAt: timestamp('spawned_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { mode: 'date', withTimezone: true }),
});
```

---

## 4. Redis Topology & Caching Engine

Redis (`node-redis`) manages daily schedule cache states, graph memoization, and concurrency locks.

| Key Pattern | Data Structure | TTL | Purpose |
| :--- | :--- | :--- | :--- |
| `rnd:sprint:active:{YYYY-MM-DD}` | JSON String | 86400s (24h) | Caches current daily generated sprint list. |
| `rnd:graph:unlocked_set` | Set (`SADD`) | 3600s (1h) | Set of node IDs whose prerequisites are fully met. |
| `rnd:lock:scheduler` | String | 10s | Prevents concurrent daily sprint calculations. |

---

## 5. Pure Mathematical Engines

### Module A: SuperMemo-2 (SM-2) Engine
Calculates memory retention decay and interval updates after each evaluation rating $q \in \{0, 1, 2, 3, 4, 5\}$.

```typescript
export interface SM2Input {
  interval: number;
  repetition: number;
  easeFactor: number;
  qualityScore: number; // 0 to 5 rating
}

export interface SM2Output {
  interval: number;
  repetition: number;
  easeFactor: number;
  nextReviewAt: Date;
}

export function calculateSM2(input: SM2Input): SM2Output {
  const { qualityScore } = input;
  let { interval, repetition, easeFactor } = input;

  // 1. Recalculate Ease Factor
  const newEf = easeFactor + (0.1 - (5 - qualityScore) * (0.08 + (5 - qualityScore) * 0.02));
  easeFactor = Math.max(1.3, newEf);

  // 2. Compute Interval and Repetitions
  if (qualityScore >= 3) {
    if (repetition === 0) {
      interval = 1;
    } else if (repetition === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetition += 1;
  } else {
    // Failure resets interval back to day 1
    repetition = 0;
    interval = 1;
  }

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  return { interval, repetition, easeFactor, nextReviewAt };
}
```

---

### Module B: 0/1 Knapsack Daily Scheduler Engine
Computes the dynamic score for each overdue node and selects the optimal set fitting target session length $M$.

$$\text{Urgency Score} = \left( \frac{\text{Current Timestamp} - \text{Next Review Timestamp}}{\text{Interval Days}} + 1 \right) \times \text{Priority Weight}$$

```typescript
export interface CandidateNode {
  id: string;
  title: string;
  estimatedMinutes: number;
  urgencyScore: number;
}

export function scheduleDailySprint(candidates: CandidateNode[], maxMinutes: number): CandidateNode[] {
  const n = candidates.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(maxMinutes + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const item = candidates[i - 1];
    for (let w = 0; w <= maxMinutes; w++) {
      if (item.estimatedMinutes <= w) {
        dp[i][w] = Math.max(
          dp[i - 1][w],
          dp[i - 1][w - item.estimatedMinutes] + item.urgencyScore
        );
      } else {
        dp[i][w] = dp[i - 1][w];
      }
    }
  }

  // Backtrack selected nodes
  const selected: CandidateNode[] = [];
  let w = maxMinutes;
  for (let i = n; i > 0 && w > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      const item = candidates[i - 1];
      selected.push(item);
      w -= item.estimatedMinutes;
    }
  }

  return selected.reverse();
}
```

---

## 6. Fastify API Handlers & Zod Schemas

### 1. Review Node Endpoint (`POST /api/v1/nodes/:id/review`)

- **Zod Schema:**
```typescript
import { z } from 'zod';

export const ReviewNodeParamsSchema = z.object({
  id: z.string().uuid(),
});

export const ReviewNodeBodySchema = z.object({
  qualityScore: z.number().int().min(0).max(5),
  timeSpentMinutes: z.number().int().positive(),
});
```

- **Route Handler Implementation:**
```typescript
fastify.post('/api/v1/nodes/:id/review', async (request, reply) => {
  const { id } = ReviewNodeParamsSchema.parse(request.params);
  const body = ReviewNodeBodySchema.parse(request.body);

  return await db.transaction(async (tx) => {
    const [node] = await tx.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, id));
    if (!node) {
      return reply.code(404).send({ success: false, error: 'NODE_NOT_FOUND' });
    }

    // Compute SM-2 update
    const sm2Result = calculateSM2({
      interval: node.smInterval,
      repetition: node.smRepetition,
      easeFactor: node.smEaseFactor,
      qualityScore: body.qualityScore,
    });

    // Write audit log
    await tx.insert(revisionLogs).values({
      nodeId: node.id,
      qualityScore: body.qualityScore,
      timeSpentMinutes: body.timeSpentMinutes,
      previousInterval: node.smInterval,
      newInterval: sm2Result.interval,
      previousEaseFactor: node.smEaseFactor,
      newEaseFactor: sm2Result.easeFactor,
    });

    // Remediation Pipeline Trigger
    let actionItemCreated = false;
    if (body.qualityScore < 2) {
      await tx.insert(actionItems).values({
        nodeId: node.id,
        title: `Rebuild & Practice Code Spike: ${node.title}`,
        status: 'PENDING',
      });
      actionItemCreated = true;
    }

    // Update Knowledge Node state
    await tx
      .update(knowledgeNodes)
      .set({
        smInterval: sm2Result.interval,
        smRepetition: sm2Result.repetition,
        smEaseFactor: sm2Result.easeFactor,
        nextReviewAt: sm2Result.nextReviewAt,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeNodes.id, node.id));

    // Invalidate Redis Sprint Cache
    const today = new Date().toISOString().split('T')[0];
    await redisClient.del(`rnd:sprint:active:${today}`);

    return reply.send({
      success: true,
      data: {
        nodeId: node.id,
        nextReviewAt: sm2Result.nextReviewAt,
        actionItemSpawned: actionItemCreated,
      },
    });
  });
});
```

---

### 2. Daily Sprint Endpoint (`GET /api/v1/schedule/daily`)

- **Zod Schema:**
```typescript
export const DailyScheduleQuerySchema = z.object({
  maxMinutes: z.coerce.number().int().positive().default(45),
});
```

- **Route Handler Implementation:**
```typescript
fastify.get('/api/v1/schedule/daily', async (request, reply) => {
  const { maxMinutes } = DailyScheduleQuerySchema.parse(request.query);
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `rnd:sprint:active:${today}`;

  // Read through Redis cache
  const cachedSprint = await redisClient.get(cacheKey);
  if (cachedSprint) {
    return reply.send({ success: true, source: 'cache', data: JSON.parse(cachedSprint) });
  }

  // Fetch overdue nodes from PostgreSQL via Drizzle
  const now = new Date();
  const overdueNodes = await db
    .select()
    .from(knowledgeNodes)
    .where(lte(knowledgeNodes.nextReviewAt, now));

  const candidates: CandidateNode[] = overdueNodes.map((node) => {
    const daysOverdue = Math.max(0, (now.getTime() - node.nextReviewAt.getTime()) / (1000 * 3600 * 24));
    const urgencyScore = (daysOverdue / node.smInterval + 1) * node.priorityWeight;
    return {
      id: node.id,
      title: node.title,
      estimatedMinutes: node.estimatedMinutes,
      urgencyScore,
    };
  });

  // Calculate sprint array
  const sprintPlan = scheduleDailySprint(candidates, maxMinutes);

  // Write Cache (TTL: 24h)
  await redisClient.setEx(cacheKey, 86400, JSON.stringify(sprintPlan));

  return reply.send({
    success: true,
    source: 'computed',
    data: {
      totalTasks: sprintPlan.length,
      allocatedMinutes: sprintPlan.reduce((acc, curr) => acc + curr.estimatedMinutes, 0),
      items: sprintPlan,
    },
  });
});
```

---

## 7. Development Roadmap

1. **Phase 1: Environment & Schema Bootstrapping**
   - Initialize Fastify project with TypeScript.
   - Run Drizzle migrations using `postgres.js`.
   - Setup Redis connection module with auto-reconnect.
2. **Phase 2: Math Engine & Unit Testing**
   - Unit test `calculateSM2()` edge cases.
   - Benchmark Knapsack dynamic programming scheduler.
3. **Phase 3: Fastify Routes & Transaction Boundaries**
   - Implement review endpoints inside PostgreSQL transactions.
   - Attach Redis caching logic to daily query handlers.
4. **Phase 4: Client Integration**
   - Build TUI or light web frontend to start logging sessions daily.