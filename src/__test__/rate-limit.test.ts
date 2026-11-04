import { describe, expect, it } from 'vitest';
import { buildTestApp, createFakeBucket, createInMemoryMemoRepository } from './helpers.js';

const denied = { allowed: false, remaining: 0, retryAfterMs: 2500, fullInMs: 60_000 };

describe('rate limit plugin', () => {
	it('counts a request against the client IP and sets RateLimit headers', async () => {
		const { bucket, calls } = createFakeBucket();
		await using app = buildTestApp({ bucket });

		const res = await app.inject({ method: 'GET', url: '/memos', remoteAddress: '203.0.113.7' });

		expect(res.statusCode).toBe(200);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.key).toBe('rl:global:203.0.113.7');
		expect(calls[0]?.policy).toEqual({ capacity: 60, refillPerSecond: 1, cost: 1 });
		expect(res.headers).toMatchObject({
			'ratelimit-limit': '60',
			'ratelimit-remaining': '59',
			'ratelimit-reset': '1',
		});
	});

	it('keeps clients apart', async () => {
		const { bucket, calls } = createFakeBucket();
		await using app = buildTestApp({ bucket });

		await app.inject({ method: 'GET', url: '/memos', remoteAddress: '198.51.100.1' });
		await app.inject({ method: 'GET', url: '/memos', remoteAddress: '198.51.100.2' });

		expect(new Set(calls.map((call) => call.key)).size).toBe(2);
	});

	it('answers 429 with Retry-After and the standard error body when the bucket is empty', async () => {
		const { bucket } = createFakeBucket(() => denied);
		await using app = buildTestApp({ bucket });

		const res = await app.inject({ method: 'GET', url: '/memos' });

		expect(res.statusCode).toBe(429);
		expect(res.json()).toEqual({
			code: 'rate_limited',
			message: 'Too many requests',
			details: { retryAfterSeconds: 3 },
		});
		expect(res.headers['retry-after']).toBe('3');
		expect(res.headers['ratelimit-remaining']).toBe('0');
	});

	it('does not run the handler for a limited request', async () => {
		const { bucket } = createFakeBucket(() => denied);
		const repository = createInMemoryMemoRepository();
		let inserted = 0;
		const insert = repository.insert;
		repository.insert = async (input) => (inserted++, insert(input));
		await using app = buildTestApp({ bucket, repository });

		const res = await app.inject({ method: 'POST', url: '/memos', payload: { title: 'x' } });

		expect(res.statusCode).toBe(429);
		expect(inserted).toBe(0);
	});

	it('exempts health endpoints', async () => {
		const { bucket, calls } = createFakeBucket(() => denied);
		await using app = buildTestApp({ bucket });

		expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
		expect(calls).toHaveLength(0);
	});

	it('gives a route with its own policy its own bucket', async () => {
		const { bucket, calls } = createFakeBucket();
		await using app = buildTestApp({ bucket });
		app.register(async (instance) => {
			instance.get('/expensive', { config: { rateLimit: { capacity: 3, cost: 2 } } }, async () => ({
				ok: true,
			}));
		});

		await app.inject({ method: 'GET', url: '/expensive', remoteAddress: '192.0.2.9' });

		expect(calls[0]?.key).toBe('rl:GET:/expensive:192.0.2.9');
		expect(calls[0]?.policy).toEqual({ capacity: 3, refillPerSecond: 1, cost: 2 });
	});

	it('lets a route opt out entirely', async () => {
		const { bucket, calls } = createFakeBucket(() => denied);
		await using app = buildTestApp({ bucket });
		app.register(async (instance) => {
			instance.get('/open', { config: { rateLimit: false } }, async () => ({ ok: true }));
		});

		expect((await app.inject({ method: 'GET', url: '/open' })).statusCode).toBe(200);
		expect(calls).toHaveLength(0);
	});

	it('does nothing when disabled', async () => {
		const { bucket, calls } = createFakeBucket(() => denied);
		await using app = buildTestApp({ bucket, env: { RATE_LIMIT_ENABLED: 'false' } });

		expect((await app.inject({ method: 'GET', url: '/memos' })).statusCode).toBe(200);
		expect(calls).toHaveLength(0);
	});

	it('applies configured defaults', async () => {
		const { bucket, calls } = createFakeBucket();
		await using app = buildTestApp({
			bucket,
			env: { RATE_LIMIT_CAPACITY: '5', RATE_LIMIT_REFILL_PER_SECOND: '0.5' },
		});

		await app.inject({ method: 'GET', url: '/memos' });

		expect(calls[0]?.policy).toEqual({ capacity: 5, refillPerSecond: 0.5, cost: 1 });
	});
});

describe('when the bucket (Redis) fails', () => {
	const broken = () => Promise.reject(new Error('ECONNREFUSED 10.0.0.5:6379'));

	it('fails open by default: the request goes through', async () => {
		const { bucket } = createFakeBucket(broken);
		await using app = buildTestApp({ bucket });

		const res = await app.inject({ method: 'GET', url: '/memos' });

		expect(res.statusCode).toBe(200);
		expect(res.headers['ratelimit-limit']).toBeUndefined();
	});

	it('fails closed when configured, without leaking the cause', async () => {
		const { bucket } = createFakeBucket(broken);
		await using app = buildTestApp({ bucket, env: { RATE_LIMIT_FAIL_OPEN: 'false' } });

		const res = await app.inject({ method: 'GET', url: '/memos' });

		expect(res.statusCode).toBe(503);
		expect(res.json()).toEqual({ code: 'unavailable', message: 'Service unavailable' });
		expect(res.body).not.toContain('10.0.0.5');
	});

	it('gives the bucket a signal that aborts after the timeout', async () => {
		const { bucket, calls } = createFakeBucket();
		await using app = buildTestApp({ bucket, env: { RATE_LIMIT_TIMEOUT_MS: '30' } });

		await app.inject({ method: 'GET', url: '/memos' });
		const signal = calls[0]?.signal;

		expect(signal?.aborted).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(signal?.aborted).toBe(true);
	});
});
