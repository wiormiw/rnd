import { randomUUID } from 'node:crypto';
import { NodeAdapter } from '@nestjs/platform-node';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AppModule } from '../app.module.js';
import { ConfigService } from '../config/config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { loadConfig, type Env } from '../lib/config.js';
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
	'insert' | 'findById' | 'update' | 'list' | 'remove'
>;

export function createInMemoryMemoRepository(): MemoRepositoryLike {
	const rows = new Map<string, Memo>();
	return {
		async insert(input: MemoInsert) {
			const memo: Memo = {
				id: randomUUID(),
				createdAt: new Date(),
				topicId: input.topicId ?? null,
				...input,
			} as Memo;
			rows.set(memo.id, memo);
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
				...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
			};
			rows.set(id, next);
			return next;
		},
		async list({ limit, offset }: Pagination) {
			const newestFirst = [...rows.values()].toReversed();
			return { items: newestFirst.slice(offset, offset + limit), total: rows.size };
		},
		async remove(id: string) {
			return rows.delete(id);
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
	repository?: MemoRepositoryLike;
	bucket?: TokenBucket;
	/** Environment overrides, e.g. `{ RATE_LIMIT_FAIL_OPEN: 'false' }`. */
	env?: Record<string, string>;
	/** Stand-in for `SELECT 1` used by the readiness check. */
	db?: { execute(query: unknown): Promise<unknown> };
	/** Stand-in for Redis `PING` used by the readiness check. */
	redisPing?: () => Promise<unknown>;
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
	repository = createInMemoryMemoRepository(),
	bucket = createFakeBucket().bucket,
	env = {},
	db = { execute: async () => [] },
	redisPing = async () => 'PONG',
	controllers = [],
}: TestAppOptions = {}) {
	const config: Env = loadConfig({ ...testEnv, ...env });
	const configStub = { get: <K extends keyof Env>(key: K) => config[key], getAll: () => config };

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
		.compile();

	const app = moduleRef.createNestApplication(new NodeAdapter(), { logger: false });
	await app.init();
	// supertest attaches listeners per request; concurrent tests would trip Node's default limit.
	app.getHttpServer().setMaxListeners(0);

	const agent = supertest(app.getHttpServer());

	return Object.assign(agent, {
		repository,
		bucket,
		async [Symbol.asyncDispose]() {
			await app.close();
		},
	});
}
