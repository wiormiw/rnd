import { describe, expect, it } from 'vitest';
import { Lifecycle } from '../lib/lifecycle.js';
import { createLogger, createSilentLogger } from '../lib/logger.js';
import { buildTestApp } from './helpers.js';

function captureLogger() {
	const lines: Record<string, any>[] = [];
	const logger = createLogger({
		level: 'info',
		destination: { write: (chunk: string) => void lines.push(JSON.parse(chunk)) },
	});
	return { lines, logger };
}

describe('health', () => {
	it('GET /health returns ok', async () => {
		await using app = buildTestApp();
		const res = await app.inject({ method: 'GET', url: '/health' });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ status: 'ok' });
	});

	it('GET /health/ready is 200 when every check passes', async () => {
		const lifecycle = new Lifecycle([{ name: 'a', check: async () => {} }], createSilentLogger());
		await using app = buildTestApp({ lifecycle });
		const res = await app.inject({ method: 'GET', url: '/health/ready' });

		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ status: 'ok', checks: { a: { status: 'ok' } } });
	});

	it('GET /health/ready is 503 when a check fails, without leaking the error', async () => {
		const lifecycle = new Lifecycle(
			[
				{ name: 'a', check: async () => {} },
				{
					name: 'b',
					check: async () => {
						throw new Error('password=hunter2');
					},
				},
			],
			createSilentLogger(),
		);
		await using app = buildTestApp({ lifecycle });
		const res = await app.inject({ method: 'GET', url: '/health/ready' });

		expect(res.statusCode).toBe(503);
		expect(res.json()).toMatchObject({ status: 'unavailable', checks: { b: { status: 'fail' } } });
		expect(res.body).not.toContain('hunter2');
	});
});

describe('memos', () => {
	it('creates, reads, lists and deletes a memo', async () => {
		await using app = buildTestApp();

		const created = await app.inject({
			method: 'POST',
			url: '/memos',
			payload: { title: '  Idea  ' },
		});
		expect(created.statusCode).toBe(201);
		const memo = created.json();
		expect(memo).toMatchObject({ title: 'Idea', body: '' });

		const fetched = await app.inject({ method: 'GET', url: `/memos/${memo.id}` });
		expect(fetched.statusCode).toBe(200);
		expect(fetched.json()).toEqual(memo);

		const listed = await app.inject({ method: 'GET', url: '/memos' });
		expect(listed.json()).toEqual({ items: [memo], total: 1, limit: 20, offset: 0 });

		const deleted = await app.inject({ method: 'DELETE', url: `/memos/${memo.id}` });
		expect(deleted.statusCode).toBe(204);

		const gone = await app.inject({ method: 'GET', url: `/memos/${memo.id}` });
		expect(gone.statusCode).toBe(404);
	});

	it('paginates newest first', async () => {
		await using app = buildTestApp();
		for (const title of ['a', 'b', 'c']) {
			await app.inject({ method: 'POST', url: '/memos', payload: { title } });
		}

		const res = await app.inject({ method: 'GET', url: '/memos?limit=2&offset=1' });
		const page = res.json();
		expect(page).toMatchObject({ total: 3, limit: 2, offset: 1 });
		expect(page.items.map((memo: { title: string }) => memo.title)).toEqual(['b', 'a']);
	});

	it('patches only the given fields and ignores server-owned ones', async () => {
		await using app = buildTestApp();
		const memo = (
			await app.inject({ method: 'POST', url: '/memos', payload: { title: 'a', body: 'keep' } })
		).json();

		const res = await app.inject({
			method: 'PATCH',
			url: `/memos/${memo.id}`,
			payload: { title: '  b  ' },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ ...memo, title: 'b' });

		const forged = await app.inject({
			method: 'PATCH',
			url: `/memos/${memo.id}`,
			payload: { body: 'x', id: '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10' },
		});
		expect(forged.json()).toMatchObject({ id: memo.id, body: 'x' });
	});

	it('rejects an empty or invalid patch with 400, and an unknown id with 404', async () => {
		await using app = buildTestApp();
		const id = '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10';
		const patch = (url: string, payload: object) => app.inject({ method: 'PATCH', url, payload });

		expect((await patch(`/memos/${id}`, {})).statusCode).toBe(400);
		expect((await patch(`/memos/${id}`, { title: '' })).statusCode).toBe(400);
		expect((await patch(`/memos/${id}`, { title: 'ok' })).statusCode).toBe(404);
	});

	it('rejects bad pagination with 400', async () => {
		await using app = buildTestApp();
		const res = await app.inject({ method: 'GET', url: '/memos?limit=1000' });
		expect(res.statusCode).toBe(400);
	});
});

describe('error handling at the edge', () => {
	it('maps a business not_found to 404 with the standard body', async () => {
		await using app = buildTestApp();
		const id = '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10';
		const res = await app.inject({ method: 'GET', url: `/memos/${id}` });

		expect(res.statusCode).toBe(404);
		expect(res.json()).toEqual({
			code: 'not_found',
			message: 'memo not found',
			details: { resource: 'memo', id },
		});
	});

	it('maps schema validation errors to 400', async () => {
		await using app = buildTestApp();
		const res = await app.inject({ method: 'POST', url: '/memos', payload: { title: '' } });

		expect(res.statusCode).toBe(400);
		expect(res.json()).toMatchObject({ code: 'invalid', message: 'Request validation failed' });
		expect(res.json().details[0]).toMatchObject({ path: '/title' });
	});

	it('rejects a non-uuid id with 400', async () => {
		await using app = buildTestApp();
		const res = await app.inject({ method: 'GET', url: '/memos/not-a-uuid' });
		expect(res.statusCode).toBe(400);
	});

	it('uses the same body for unknown routes', async () => {
		await using app = buildTestApp();
		const res = await app.inject({ method: 'GET', url: '/nope' });

		expect(res.statusCode).toBe(404);
		expect(res.json()).toMatchObject({ code: 'not_found' });
	});

	it('maps malformed JSON to a 4xx invalid error', async () => {
		await using app = buildTestApp();
		const res = await app.inject({
			method: 'POST',
			url: '/memos',
			headers: { 'content-type': 'application/json' },
			payload: '{not json',
		});

		expect(res.statusCode).toBe(400);
		expect(res.json()).toMatchObject({ code: 'invalid' });
	});

	it('hides the cause of unexpected failures behind a generic 500', async () => {
		const repository = {
			...(await import('./helpers.js')).createInMemoryMemoRepository(),
			findById: async (): Promise<never> => {
				throw new Error('connection to 10.0.0.7 refused, password=hunter2');
			},
		};
		await using app = buildTestApp({ repository });
		const res = await app.inject({
			method: 'GET',
			url: '/memos/0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10',
		});

		expect(res.statusCode).toBe(500);
		expect(res.json()).toEqual({ code: 'internal', message: 'Internal server error' });
		expect(res.body).not.toContain('hunter2');
	});
});

describe('request context', () => {
	it('echoes a unique request id and stamps it on service logs via AsyncLocalStorage', async () => {
		const { lines, logger } = captureLogger();
		await using app = buildTestApp({ logger });

		const res = await app.inject({ method: 'POST', url: '/memos', payload: { title: 'x' } });
		const requestId = res.headers['x-request-id'];

		expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
		// The service never received the request: it found it through ALS.
		const created = lines.find((line) => line['msg'] === 'memo created');
		expect(created?.['reqId']).toBe(requestId);
	});

	it('keeps concurrent requests apart', async () => {
		const { lines, logger } = captureLogger();
		await using app = buildTestApp({ logger });

		const responses = await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				app.inject({ method: 'POST', url: '/memos', payload: { title: `m${i}` } }),
			),
		);

		const ids = responses.map((res) => res.headers['x-request-id']);
		expect(new Set(ids).size).toBe(20);
		const logged = lines.filter((line) => line['msg'] === 'memo created').map((l) => l['reqId']);
		expect(new Set(logged)).toEqual(new Set(ids));
	});

	it('redacts sensitive headers and uses the standalone logger serializers', async () => {
		const { lines, logger } = captureLogger();
		await using app = buildTestApp({ logger });

		await app.inject({
			method: 'GET',
			url: '/health',
			headers: { authorization: 'Bearer s3cret' },
		});

		const incoming = lines.find((line) => line['msg'] === 'incoming request');
		expect(incoming?.['req']).toMatchObject({ method: 'GET', url: '/health' });
		expect(JSON.stringify(lines)).not.toContain('s3cret');
	});
});

describe('disposal', () => {
	it('stops the lifecycle when the app is disposed', async () => {
		const lifecycle = new Lifecycle([], createSilentLogger());
		await lifecycle.start();
		{
			await using app = buildTestApp({ lifecycle });
			await app.ready();
		}
		expect(lifecycle.state).toBe('stopped');
	});
});
