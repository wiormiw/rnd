import { Controller, Get } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requestContext } from '../common/request-context.js';
import { buildTestApp, createInMemoryMemoRepository } from './helpers.js';

const unknownId = '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10';

/** Echoes the request id the middleware stored in AsyncLocalStorage. */
@Controller('probe')
class ProbeController {
	@Get()
	probe() {
		return { requestId: requestContext.get()?.requestId };
	}
}

describe('health', () => {
	it('GET /health returns ok', async () => {
		await using app = await buildTestApp();
		const res = await app.get('/health');
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ status: 'ok' });
	});

	it('GET /health/ready is 200 when every dependency answers', async () => {
		await using app = await buildTestApp();
		const res = await app.get('/health/ready');

		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			status: 'ok',
			details: { database: { status: 'up' }, redis: { status: 'up' } },
		});
	});

	it('GET /health/ready is 503 when a dependency fails, without leaking the error', async () => {
		await using app = await buildTestApp({
			db: {
				execute: async () => {
					throw new Error('password=hunter2');
				},
			},
		});
		const res = await app.get('/health/ready');

		expect(res.status).toBe(503);
		expect(res.body).toMatchObject({ status: 'error', details: { database: { status: 'down' } } });
		expect(res.text).not.toContain('hunter2');
	});
});

describe('memos', () => {
	it('creates, reads, lists and deletes a memo', async () => {
		await using app = await buildTestApp();

		const created = await app.post('/api/v1/memos').send({ title: '  Idea  ' });
		expect(created.status).toBe(201);
		const memo = created.body;
		expect(memo).toMatchObject({ title: 'Idea', body: '' });

		const fetched = await app.get(`/api/v1/memos/${memo.id}`);
		expect(fetched.status).toBe(200);
		expect(fetched.body).toEqual(memo);

		const listed = await app.get('/api/v1/memos');
		expect(listed.body).toEqual({ items: [memo], total: 1, limit: 20, offset: 0 });

		const deleted = await app.delete(`/api/v1/memos/${memo.id}`);
		expect(deleted.status).toBe(204);

		const gone = await app.get(`/api/v1/memos/${memo.id}`);
		expect(gone.status).toBe(404);
	});

	it('paginates newest first', async () => {
		await using app = await buildTestApp();
		for (const title of ['a', 'b', 'c']) {
			await app.post('/api/v1/memos').send({ title });
		}

		const res = await app.get('/api/v1/memos?limit=2&offset=1');
		expect(res.body).toMatchObject({ total: 3, limit: 2, offset: 1 });
		expect(res.body.items.map((memo: { title: string }) => memo.title)).toEqual(['b', 'a']);
	});

	it('patches only the given fields and ignores server-owned ones', async () => {
		await using app = await buildTestApp();
		const memo = (await app.post('/api/v1/memos').send({ title: 'a', body: 'keep' })).body;

		const res = await app.patch(`/api/v1/memos/${memo.id}`).send({ title: '  b  ' });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ...memo, title: 'b' });

		const forged = await app
			.patch(`/api/v1/memos/${memo.id}`)
			.send({ body: 'x', id: '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10' });
		expect(forged.body).toMatchObject({ id: memo.id, body: 'x' });
	});

	it('rejects an empty or invalid patch with 400, and an unknown id with 404', async () => {
		await using app = await buildTestApp();

		expect((await app.patch(`/api/v1/memos/${unknownId}`).send({})).status).toBe(400);
		expect((await app.patch(`/api/v1/memos/${unknownId}`).send({ title: '' })).status).toBe(400);
		expect((await app.patch(`/api/v1/memos/${unknownId}`).send({ title: 'ok' })).status).toBe(404);
	});

	it('rejects bad pagination with 400', async () => {
		await using app = await buildTestApp();
		const res = await app.get('/api/v1/memos?limit=1000');
		expect(res.status).toBe(400);
	});
});

describe('error handling at the edge', () => {
	it('maps a business not_found to 404 with the standard body', async () => {
		await using app = await buildTestApp();
		const res = await app.get(`/api/v1/memos/${unknownId}`);

		expect(res.status).toBe(404);
		expect(res.body).toEqual({
			code: 'not_found',
			message: 'memo not found',
			details: { resource: 'memo', id: unknownId },
		});
	});

	it('maps schema validation errors to 400', async () => {
		await using app = await buildTestApp();
		const res = await app.post('/api/v1/memos').send({ title: '' });

		expect(res.status).toBe(400);
		expect(res.body).toMatchObject({ code: 'invalid', message: 'Request validation failed' });
		expect(res.body.details[0]).toMatchObject({ path: 'title' });
	});

	it('rejects a non-uuid id with 400', async () => {
		await using app = await buildTestApp();
		const res = await app.get('/api/v1/memos/not-a-uuid');
		expect(res.status).toBe(400);
	});

	it('uses the same body for unknown routes', async () => {
		await using app = await buildTestApp();
		const res = await app.get('/api/v1/nope');

		expect(res.status).toBe(404);
		expect(res.body).toMatchObject({ code: 'not_found' });
	});

	it('maps malformed JSON to a 4xx invalid error', async () => {
		await using app = await buildTestApp();
		const res = await app
			.post('/api/v1/memos')
			.set('content-type', 'application/json')
			.send('{not json');

		expect(res.status).toBe(400);
		expect(res.body).toMatchObject({ code: 'invalid' });
	});

	it('hides the cause of unexpected failures behind a generic 500', async () => {
		const repository = {
			...createInMemoryMemoRepository(),
			findById: async (): Promise<never> => {
				throw new Error('connection to 10.0.0.7 refused, password=hunter2');
			},
		};
		await using app = await buildTestApp({ repository });
		const res = await app.get(`/api/v1/memos/${unknownId}`);

		expect(res.status).toBe(500);
		expect(res.body).toEqual({ code: 'internal', message: 'Internal server error' });
		expect(res.text).not.toContain('hunter2');
	});
});

describe('request context', () => {
	it('echoes a unique request id and makes it visible below the controller via AsyncLocalStorage', async () => {
		await using app = await buildTestApp({ controllers: [ProbeController] });

		const res = await app.get('/api/v1/probe');
		const requestId = res.header['x-request-id'];

		expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
		expect(res.body).toEqual({ requestId });
	});

	it('keeps concurrent requests apart', async () => {
		await using app = await buildTestApp({ controllers: [ProbeController] });

		const responses = await Promise.all(Array.from({ length: 20 }, () => app.get('/api/v1/probe')));

		const ids = responses.map((res) => res.header['x-request-id']);
		expect(new Set(ids).size).toBe(20);
		expect(responses.map((res) => res.body.requestId)).toEqual(ids);
	});
});
