import { randomUUID } from 'node:crypto';
import { NodeAdapter } from '@nestjs/platform-node';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AppModule } from '../app.module.js';
import { configureApp } from '../configure-app.js';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { loadConfig, type Env } from '../lib/config.js';
import { ActionItemsRepository } from '../action-items/action-items.repository.js';
import type { ActionItem } from '../action-items/action-item.schema.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { ReviewsRepository } from '../reviews/reviews.repository.js';
import type { ReviewLog } from '../reviews/review.schema.js';
import { ScheduleRepository } from '../schedule/schedule.repository.js';
import { CardsRepository } from '../cards/cards.repository.js';
import type { Card, CardInsert, CardUpdate } from '../cards/card.schema.js';
import { CurriculumRepository } from '../curriculum/curriculum.repository.js';
import type { TopicInsert, TopicRow, TopicUpdate } from '../curriculum/topic.schema.js';
import type { Edge } from '../engines/index.js';
import { MemosRepository } from '../memos/memos.repository.js';
import type { Memo, MemoInsert, MemoUpdate } from '../memos/memo.schema.js';
import type { Pagination } from '../common/schemas.js';
import { RedisService, TOKEN_BUCKET_TOKEN } from '../redis/redis.service.js';
import type { BucketResult, TokenBucket } from '../redis/token-bucket.js';

export const testEnv = {
	DB_URL: 'postgres://rnd:rnd@127.0.0.1:5432/rnd',
	REDIS_URL: 'redis://127.0.0.1:6379',
	NODE_ENV: 'test',
	LOG_LEVEL: 'silent',
} as const;

/** The subset of the repository the service uses; the in-memory one implements it. */
export type MemoRepositoryLike = Pick<
	MemosRepository,
	'insert' | 'findById' | 'update' | 'list' | 'remove' | 'listByTopic' | 'topicExists'
>;

/** State shared by the in-memory repositories so cross-module behaviour is testable. */
export interface InMemoryStore {
	topics: Map<string, TopicRow>;
	edges: Edge[];
	cards: Map<string, Card>;
	memoIds: Set<string>;
	reviewLogs: ReviewLog[];
	actionItems: Map<string, ActionItem>;
}

const pendingItemFor = (store: InMemoryStore, cardId: string) =>
	[...store.actionItems.values()].find((i) => i.cardId === cardId && i.status === 'PENDING');

function createInMemoryStore(): InMemoryStore {
	return {
		topics: new Map(),
		edges: [],
		cards: new Map(),
		memoIds: new Set(),
		reviewLogs: [],
		actionItems: new Map(),
	};
}

export function createInMemoryMemoRepository(
	store: InMemoryStore = createInMemoryStore(),
): MemoRepositoryLike {
	const rows = new Map<string, Memo>();
	return {
		async insert(input: MemoInsert) {
			const memo: Memo = {
				id: randomUUID(),
				createdAt: nextDate(),
				...input,
				topicId: input.topicId ?? null,
			};
			rows.set(memo.id, memo);
			store.memoIds.add(memo.id);
			return memo;
		},
		async findById(id: string) {
			return rows.get(id);
		},
		async update(id: string, patch: MemoUpdate) {
			const current = rows.get(id);
			if (!current) return undefined;
			const next: Memo = {
				...current,
				...definedOnly(patch),
			};
			rows.set(id, next);
			return next;
		},
		async list({ limit, offset }: Pagination) {
			const newestFirst = [...rows.values()].toReversed();
			return { items: newestFirst.slice(offset, offset + limit), total: rows.size };
		},
		async remove(id: string) {
			store.memoIds.delete(id);
			return rows.delete(id);
		},
		async listByTopic(topicId: string, { limit, offset }: Pagination) {
			const matching = [...rows.values()].filter((m) => m.topicId === topicId).toReversed();
			return { items: matching.slice(offset, offset + limit), total: matching.length };
		},
		async topicExists(id: string) {
			return store.topics.has(id);
		},
	};
}

type CurriculumRepositoryLike = Pick<
	CurriculumRepository,
	| 'insertTopic'
	| 'findTopic'
	| 'updateTopic'
	| 'removeTopic'
	| 'listTopics'
	| 'listEdges'
	| 'addPrerequisite'
	| 'removePrerequisite'
	| 'masteryInputs'
>;

/** Drops `undefined` values, like a SQL UPDATE that skips unset columns. */
function definedOnly(patch: object): object {
	return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
}

let tick = 0;
/** Strictly increasing timestamps, so createdAt ordering is deterministic. */
const nextDate = () => new Date(Date.UTC(2026, 0, 1) + tick++);

/** Mirrors the ON DELETE CASCADE of review logs and action items. */
function removeCardData(store: InMemoryStore, cardId: string) {
	store.reviewLogs = store.reviewLogs.filter((l) => l.cardId !== cardId);
	for (const item of store.actionItems.values()) {
		if (item.cardId === cardId) store.actionItems.delete(item.id);
	}
}

function createInMemoryCurriculumRepository(store: InMemoryStore): CurriculumRepositoryLike {
	return {
		async insertTopic(input: TopicInsert) {
			const now = nextDate();
			const topic: TopicRow = { id: randomUUID(), createdAt: now, updatedAt: now, ...input };
			store.topics.set(topic.id, topic);
			return topic;
		},
		async findTopic(id: string) {
			return store.topics.get(id);
		},
		async updateTopic(id: string, patch: TopicUpdate) {
			const current = store.topics.get(id);
			if (!current) return undefined;
			const next: TopicRow = {
				...current,
				...definedOnly(patch),
				updatedAt: nextDate(),
			};
			store.topics.set(id, next);
			return next;
		},
		async removeTopic(id: string) {
			if (!store.topics.delete(id)) return false;
			store.edges = store.edges.filter((e) => e.topicId !== id && e.prerequisiteId !== id);
			for (const card of store.cards.values()) {
				if (card.topicId !== id) continue;
				removeCardData(store, card.id);
				store.cards.delete(card.id);
			}
			return true;
		},
		async listTopics() {
			return [...store.topics.values()].toSorted(
				(a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
			);
		},
		async listEdges() {
			return [...store.edges];
		},
		async addPrerequisite(topicId, prerequisiteId, check) {
			const cycle = check([...store.edges]);
			if (cycle) return { cycle };
			const exists = store.edges.some(
				(e) => e.topicId === topicId && e.prerequisiteId === prerequisiteId,
			);
			if (!exists) store.edges.push({ topicId, prerequisiteId });
			return { added: !exists };
		},
		async removePrerequisite(topicId: string, prerequisiteId: string) {
			const before = store.edges.length;
			store.edges = store.edges.filter(
				(e) => !(e.topicId === topicId && e.prerequisiteId === prerequisiteId),
			);
			return store.edges.length < before;
		},
		async masteryInputs() {
			return {
				cards: [...store.cards.values()].map((c) => ({
					id: c.id,
					topicId: c.topicId,
					repetition: c.smRepetition,
				})),
				pendingCardIds: [...store.actionItems.values()]
					.filter((i) => i.status === 'PENDING')
					.map((i) => i.cardId),
			};
		},
	};
}

type CardsRepositoryLike = Pick<
	CardsRepository,
	'insert' | 'findById' | 'update' | 'remove' | 'listByTopic' | 'memoExists' | 'topicExists'
>;

function createInMemoryCardsRepository(store: InMemoryStore): CardsRepositoryLike {
	return {
		async insert(topicId: string, input: CardInsert) {
			const now = nextDate();
			const card: Card = {
				id: randomUUID(),
				topicId,
				memoId: input.memoId ?? null,
				front: input.front,
				back: input.back,
				estimatedMinutes: input.estimatedMinutes,
				priorityWeight: input.priorityWeight,
				smInterval: 0,
				smRepetition: 0,
				smEaseFactor: 2.5,
				nextReviewAt: now,
				createdAt: now,
				updatedAt: now,
			};
			store.cards.set(card.id, card);
			return card;
		},
		async findById(id: string) {
			return store.cards.get(id);
		},
		async update(id: string, patch: CardUpdate) {
			const current = store.cards.get(id);
			if (!current) return undefined;
			const next: Card = {
				...current,
				...definedOnly(patch),
				updatedAt: nextDate(),
			};
			store.cards.set(id, next);
			return next;
		},
		async remove(id: string) {
			removeCardData(store, id);
			return store.cards.delete(id);
		},
		async listByTopic(topicId: string, { limit, offset }: Pagination) {
			const all = [...store.cards.values()]
				.filter((c) => c.topicId === topicId)
				.toSorted(
					(a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
				);
			return { items: all.slice(offset, offset + limit), total: all.length };
		},
		async memoExists(id: string) {
			return store.memoIds.has(id);
		},
		async topicExists(id: string) {
			return store.topics.has(id);
		},
	};
}

function newestFirst<T>(rows: T[], { limit, offset }: Pagination) {
	const sorted = rows.toReversed();
	return { items: sorted.slice(offset, offset + limit), total: sorted.length };
}

type ReviewsRepositoryLike = Pick<ReviewsRepository, 'applyReview' | 'cardExists' | 'listByCard'>;

function createInMemoryReviewsRepository(store: InMemoryStore): ReviewsRepositoryLike {
	return {
		async applyReview(cardId, decide) {
			const card = store.cards.get(cardId);
			if (!card) return { kind: 'not_found' };
			const pending = pendingItemFor(store, cardId);
			if (pending) return { kind: 'pending', actionItemId: pending.id };

			const { sm2, log, actionItemTitle } = decide(card);
			store.reviewLogs.push({ id: randomUUID(), cardId, ...log });
			let actionItem: ActionItem | null = null;
			if (actionItemTitle !== null) {
				actionItem = {
					id: randomUUID(),
					cardId,
					title: actionItemTitle,
					status: 'PENDING',
					spawnedAt: log.reviewedAt,
					completedAt: null,
				};
				store.actionItems.set(actionItem.id, actionItem);
			}
			const updated: Card = {
				...card,
				smInterval: sm2.interval,
				smRepetition: sm2.repetition,
				smEaseFactor: sm2.easeFactor,
				nextReviewAt: sm2.nextReviewAt,
				updatedAt: log.reviewedAt,
			};
			store.cards.set(cardId, updated);
			return { kind: 'ok', card: updated, actionItem };
		},
		async cardExists(id: string) {
			return store.cards.has(id);
		},
		async listByCard(cardId: string, page: Pagination) {
			return newestFirst(
				store.reviewLogs.filter((l) => l.cardId === cardId),
				page,
			);
		},
	};
}

type ActionItemsRepositoryLike = Pick<ActionItemsRepository, 'list' | 'complete'>;

function createInMemoryActionItemsRepository(store: InMemoryStore): ActionItemsRepositoryLike {
	return {
		async list({ status, limit, offset }) {
			const matching = [...store.actionItems.values()].filter(
				(i) => !status || i.status === status,
			);
			return newestFirst(matching, { limit, offset });
		},
		async complete(id: string, now: Date) {
			const item = store.actionItems.get(id);
			if (!item) return { kind: 'not_found' };
			if (item.status === 'DONE') return { kind: 'already_done' };
			const done: ActionItem = { ...item, status: 'DONE', completedAt: now };
			store.actionItems.set(id, done);
			const card = store.cards.get(item.cardId);
			if (card) store.cards.set(card.id, { ...card, nextReviewAt: now, updatedAt: now });
			return { kind: 'ok', item: done };
		},
	};
}

type ScheduleRepositoryLike = Pick<ScheduleRepository, 'dueCards'>;

function createInMemoryScheduleRepository(store: InMemoryStore): ScheduleRepositoryLike {
	return {
		async dueCards(now: Date) {
			return [...store.cards.values()].filter(
				(c) => c.nextReviewAt <= now && !pendingItemFor(store, c.id),
			);
		},
	};
}

/** A clock tests can move. */
interface FakeClock extends Clock {
	set(date: Date): void;
}

function createFakeClock(start: Date): FakeClock {
	let current = start;
	return {
		now: () => current,
		set(date) {
			current = date;
		},
	};
}

const allowAll: BucketResult = {
	allowed: true,
	remaining: 59,
	retryAfterMs: 0,
	fullInMs: 1000,
};

/** A scripted bucket that records every call. The real one needs Redis. */
export function createFakeBucket(
	respond: (key: string) => BucketResult | Promise<BucketResult> = () => allowAll,
) {
	const calls: { key: string; policy: Parameters<TokenBucket>[1]; signal: AbortSignal }[] = [];
	const bucket: TokenBucket = async (key, policy, signal) => {
		calls.push({ key, policy, signal });
		return respond(key);
	};
	return { bucket, calls };
}

export interface TestAppOptions {
	/** Shared by the in-memory curriculum, cards and (default) memo repositories. */
	store?: InMemoryStore;
	repository?: MemoRepositoryLike;
	bucket?: TokenBucket;
	/** Environment overrides, e.g. `{ RATE_LIMIT_FAIL_OPEN: 'false' }`. */
	env?: Record<string, string>;
	/** Stand-in for `SELECT 1` used by the readiness check. */
	db?: { execute(query: unknown): Promise<unknown> };
	/** Stand-in for Redis `PING` used by the readiness check. */
	redisPing?: () => Promise<unknown>;
	/** Initial time of the fake clock; move it later with `app.clock.set(date)`. */
	now?: Date;
	/** Extra controllers, e.g. probes that exercise a decorator or the request context. */
	controllers?: Type<unknown>[];
}

/**
 * The real AppModule with the database and Redis replaced by stand-ins, so no
 * Postgres or Redis is needed. Returns a supertest agent.
 *
 * Use as `await using app = await buildTestApp()`.
 */
export async function buildTestApp({
	store = createInMemoryStore(),
	repository = createInMemoryMemoRepository(store),
	bucket = createFakeBucket().bucket,
	env = {},
	db = { execute: async () => [] },
	redisPing = async () => 'PONG',
	controllers = [],
	now = new Date(Date.UTC(2026, 5, 1)),
}: TestAppOptions = {}) {
	const config: Env = loadConfig({ ...testEnv, ...env });
	const configStub = { get: <K extends keyof Env>(key: K) => config[key], getAll: () => config };

	const clock = createFakeClock(now);

	const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers })
		.overrideProvider(ConfigService)
		.useValue(configStub)
		.overrideProvider(DatabaseService)
		.useValue({ db, onApplicationBootstrap() {}, onApplicationShutdown() {} })
		.overrideProvider(RedisService)
		.useValue({
			client: { ping: redisPing },
			bucket,
			onApplicationBootstrap() {},
			onApplicationShutdown() {},
		})
		.overrideProvider(TOKEN_BUCKET_TOKEN)
		.useValue(bucket)
		.overrideProvider(MemosRepository)
		.useValue(repository)
		.overrideProvider(CurriculumRepository)
		.useValue(createInMemoryCurriculumRepository(store))
		.overrideProvider(CardsRepository)
		.useValue(createInMemoryCardsRepository(store))
		.overrideProvider(ReviewsRepository)
		.useValue(createInMemoryReviewsRepository(store))
		.overrideProvider(ActionItemsRepository)
		.useValue(createInMemoryActionItemsRepository(store))
		.overrideProvider(ScheduleRepository)
		.useValue(createInMemoryScheduleRepository(store))
		.overrideProvider(CLOCK)
		.useValue(clock)
		.compile();

	const app = moduleRef.createNestApplication(new NodeAdapter(), { logger: false });
	configureApp(app);
	await app.init();
	// supertest attaches listeners per request; concurrent tests would trip Node's default limit.
	app.getHttpServer().setMaxListeners(0);

	const agent = supertest(app.getHttpServer());

	return Object.assign(agent, {
		repository,
		store,
		clock,
		bucket,
		async [Symbol.asyncDispose]() {
			await app.close();
		},
	});
}
