import { describe, expect, it } from 'vitest';
import { createRedis } from '../infrastructure/cache/client.js';
import { loadConfig } from '../lib/config.js';
import { Lifecycle, LifecycleError } from '../lib/lifecycle.js';
import { createSilentLogger } from '../lib/logger.js';
import { testEnv } from './helpers.js';

const logger = createSilentLogger();

describe('createRedis', () => {
	it('does not touch the network until started', async () => {
		await using redis = createRedis(loadConfig(testEnv), logger);
		expect(redis.client.isOpen).toBe(false);
	});

	it('fails startup fast when Redis is unreachable, then cleans up', async () => {
		const env = loadConfig({
			...testEnv,
			REDIS_URL: 'redis://127.0.0.1:1',
			REDIS_STARTUP_RETRIES: '1',
			REDIS_CONNECT_TIMEOUT_MS: '500',
		});
		const { resource, client } = createRedis(env, logger);
		const lifecycle = new Lifecycle([resource], logger, { startMs: 5000 });

		const began = performance.now();
		await expect(lifecycle.start()).rejects.toThrow(LifecycleError);

		expect(performance.now() - began).toBeLessThan(3000);
		expect(lifecycle.state).toBe('stopped');
		expect(client.isOpen).toBe(false);
	}, 10_000);
});

describe('redis env', () => {
	it('has safe defaults', () => {
		const config = loadConfig(testEnv);
		expect(config).toMatchObject({
			REDIS_KEY_PREFIX: 'rnd:',
			REDIS_DISABLE_OFFLINE_QUEUE: true,
			REDIS_STARTUP_RETRIES: 2,
			RATE_LIMIT_ENABLED: true,
			RATE_LIMIT_CAPACITY: 60,
			RATE_LIMIT_REFILL_PER_SECOND: 1,
			RATE_LIMIT_FAIL_OPEN: true,
			TRUST_PROXY: false,
		});
		expect(config.REDIS_DATABASE).toBeUndefined();
	});

	it('requires REDIS_URL', () => {
		expect(() => loadConfig({ DB_URL: testEnv.DB_URL })).toThrow('REDIS_URL: is required');
	});

	it('accepts a fractional refill rate and rejects a non-positive one', () => {
		expect(
			loadConfig({ ...testEnv, RATE_LIMIT_REFILL_PER_SECOND: '0.5' }).RATE_LIMIT_REFILL_PER_SECOND,
		).toBe(0.5);
		expect(() => loadConfig({ ...testEnv, RATE_LIMIT_REFILL_PER_SECOND: '0' })).toThrow();
	});
});
