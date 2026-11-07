import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

const unknownId = '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10';

describe('memo <-> topic', () => {
	it('creates a memo linked to a topic and lists memos by topic, newest first', async () => {
		await using app = await buildTestApp();
		const t = (await app.post('/api/v1/topics').send({ title: 'T' })).body.id as string;
		const other = (await app.post('/api/v1/topics').send({ title: 'O' })).body.id as string;

		const first = await app.post('/api/v1/memos').send({ title: 'one', topicId: t });
		expect(first.status).toBe(201);
		expect(first.body.topicId).toBe(t);
		const second = await app.post('/api/v1/memos').send({ title: 'two', topicId: t });
		await app.post('/api/v1/memos').send({ title: 'elsewhere', topicId: other });
		const loose = await app.post('/api/v1/memos').send({ title: 'loose' });
		expect(loose.body.topicId).toBeNull();

		const res = await app.get(`/api/v1/topics/${t}/memos`);
		expect(res.status).toBe(200);
		expect(res.body.total).toBe(2);
		expect(res.body.items.map((m: { id: string }) => m.id)).toEqual([
			second.body.id,
			first.body.id,
		]);

		const page = await app.get(`/api/v1/topics/${t}/memos?limit=1&offset=1`);
		expect(page.body).toMatchObject({ total: 2, limit: 1, offset: 1 });
		expect(page.body.items[0].id).toBe(first.body.id);
	});

	it('404s for an unknown topic', async () => {
		await using app = await buildTestApp();
		const create = await app.post('/api/v1/memos').send({ title: 'x', topicId: unknownId });
		expect(create.status).toBe(404);
		expect(create.body.details).toMatchObject({ resource: 'topic' });
		expect((await app.get(`/api/v1/topics/${unknownId}/memos`)).status).toBe(404);

		const memo = (await app.post('/api/v1/memos').send({ title: 'x' })).body;
		expect((await app.patch(`/api/v1/memos/${memo.id}`).send({ topicId: unknownId })).status).toBe(
			404,
		);
	});

	it('links, unlinks and validates topicId on update', async () => {
		await using app = await buildTestApp();
		const t = (await app.post('/api/v1/topics').send({ title: 'T' })).body.id as string;
		const memo = (await app.post('/api/v1/memos').send({ title: 'x' })).body;

		const linked = await app.patch(`/api/v1/memos/${memo.id}`).send({ topicId: t });
		expect(linked.body.topicId).toBe(t);
		expect((await app.get(`/api/v1/topics/${t}/memos`)).body.total).toBe(1);

		const unlinked = await app.patch(`/api/v1/memos/${memo.id}`).send({ topicId: null });
		expect(unlinked.body.topicId).toBeNull();
		expect((await app.get(`/api/v1/topics/${t}/memos`)).body.total).toBe(0);

		expect((await app.post('/api/v1/memos').send({ title: 'x', topicId: 'nope' })).status).toBe(
			400,
		);
		expect((await app.patch(`/api/v1/memos/${memo.id}`).send({ topicId: 5 })).status).toBe(400);
	});
});
