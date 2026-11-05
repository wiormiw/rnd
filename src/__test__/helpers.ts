import { randomUUID } from 'node:crypto';
import { buildApp } from '../app.js';
import { createInfrastructure } from '../infrastructure/index.js';
import { loadConfig } from '../lib/config.js';
import type { Lifecycle } from '../lib/lifecycle.js';
import { createSilentLogger, type Logger } from '../lib/logger.js';
import { createServices } from '../modules/index.js';
import type { MemoRepository } from '../modules/memos/repository.js';
import type { Memo } from '../modules/memos/schema.js';
import type { BucketResult, TokenBucket } from '../plugins/rate-limit/token-bucket.js';

export const testEnv = {
	DB_URL: 'postgres://rnd:rnd@127.0.0.1:5432/rnd',
	REDIS_URL: 'redis://127.0.0.1:6379',
	NODE_ENV: 'test',
	LOG_LEVEL: 'silent',
} as const;

export function createInMemoryMemoRepository(): MemoRepository {
	const rows = new Map<string, Memo>();
	return {
		async insert(input) {
			const memo: Memo = { id: randomUUID(), createdAt: new Date(), ...input };
			rows.set(memo.id, memo);
			return memo;
		},
		async findById(id) {
			return rows.get(id);
		},
		async update(id, patch) {
			const current = rows.get(id);
			if (!current) return undefined;
			const next: Memo = {
				...current,
				...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
			};
			rows.set(id, next);
			return next;
		},
		async list({ limit, offset }) {
			const newestFirst = [...rows.values()].toReversed();
			return { items: newestFirst.slice(offset, offset + limit), total: rows.size };
		},
		async remove(id) {
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
	logger?: Logger;
	lifecycle?: Lifecycle;
	repository?: MemoRepository;
	bucket?: TokenBucket;
	/** Environment overrides, e.g. `{ RATE_LIMIT_FAIL_OPEN: 'false' }`. */
	env?: Record<string, string>;
}

/**
 * A real app wired to an in-memory repository and a fake rate-limit bucket. The
 * database and Redis clients are created but never connect, so no Postgres or
 * Redis is needed.
 *
 * Use as `await using app = buildTestApp()`.
 */
export function buildTestApp({
	logger = createSilentLogger(),
	lifecycle,
	repository = createInMemoryMemoRepository(),
	bucket = createFakeBucket().bucket,
	env = {},
}: TestAppOptions = {}) {
	const config = loadConfig({ ...testEnv, ...env });
	const infra = createInfrastructure(config, logger);
	return buildApp(config, {
		logger,
		infra: lifecycle
			? {
					...infra,
					lifecycle,
					// The copied disposer would still stop the ORIGINAL lifecycle.
					async [Symbol.asyncDispose]() {
						await lifecycle.stop();
					},
				}
			: infra,
		services: createServices({ memos: repository }, logger),
		rateLimitBucket: bucket,
	});
}
