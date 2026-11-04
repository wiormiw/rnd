import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRedis } from '../infrastructure/cache/client.js';
import { loadConfig } from '../lib/config.js';
import { Lifecycle } from '../lib/lifecycle.js';
import { createSilentLogger } from '../lib/logger.js';
import { createRedisTokenBucket } from '../plugins/rate-limit/token-bucket.js';
import { testEnv } from './helpers.js';

/**
 * Runs against a REAL Redis, so it is opt-in:
 *
 *   pnpm infra:up
 *   REDIS_TEST_URL=redis://localhost:6379 pnpm test redis.integration
 */
const url = process.env['REDIS_TEST_URL'];
const logger = createSilentLogger();

describe.skipIf(!url)('token bucket on a real Redis', () => {
	const env = loadConfig({ ...testEnv, REDIS_URL: url ?? testEnv.REDIS_URL });
	const policy = { capacity: 2, refillPerSecond: 0.001, cost: 1 };
	const signal = () => AbortSignal.timeout(2000);

	it('connects through the lifecycle and answers health checks', async () => {
		const { resource } = createRedis(env, logger);
		await using lifecycle = new Lifecycle([resource], logger);

		await lifecycle.start();

		expect(await lifecycle.check()).toMatchObject({ redis: { ok: true } });
	});

	it('limits atomically, and survives the script cache being flushed', async () => {
		const { resource, client } = createRedis(env, logger);
		await using lifecycle = new Lifecycle([resource], logger);
		await lifecycle.start();
		const bucket = createRedisTokenBucket(client);
		const key = `it:${randomUUID()}`;

		const first = await bucket(key, policy, signal());
		const second = await bucket(key, policy, signal());
		const third = await bucket(key, policy, signal());
		expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, false]);
		expect(third.retryAfterMs).toBeGreaterThan(0);

		// Redis forgets the script: the next call must reload it transparently (NOSCRIPT -> EVAL).
		await client.scriptFlush();
		const afterFlush = await bucket(`it:${randomUUID()}`, policy, signal());
		expect(afterFlush.allowed).toBe(true);

		await client.del(key);
	});

	it('never lets concurrent callers overspend the bucket', async () => {
		const { resource, client } = createRedis(env, logger);
		await using lifecycle = new Lifecycle([resource], logger);
		await lifecycle.start();
		const bucket = createRedisTokenBucket(client);
		const key = `it:${randomUUID()}`;

		const results = await Promise.all(
			Array.from({ length: 50 }, () => bucket(key, { ...policy, capacity: 10 }, signal())),
		);

		expect(results.filter((r) => r.allowed)).toHaveLength(10);
		await client.del(key);
	});
});
