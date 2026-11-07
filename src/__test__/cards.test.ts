import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

const unknownId = '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10';

async function setup() {
	const app = await buildTestApp();
	const topicId = (await app.post('/api/v1/topics').send({ title: 'T' })).body.id as string;
	return { app, topicId, url: `/api/v1/topics/${topicId}/cards` };
}

describe('cards', () => {
	it('creates with defaults and untouched scheduling state', async () => {
		const { app, topicId, url } = await setup();
		await using _ = app;
		const res = await app.post(url).send({ front: ' q ', back: ' a ' });
		expect(res.status).toBe(201);
		expect(res.body).toMatchObject({
			topicId,
			front: 'q',
			back: 'a',
			memoId: null,
			estimatedMinutes: 2,
			priorityWeight: 1,
			smInterval: 0,
			smRepetition: 0,
			smEaseFactor: 2.5,
		});
	});

	it('rejects server-owned and unknown fields', async () => {
		const { app, url } = await setup();
		await using _ = app;
		const base = { front: 'q', back: 'a' };
		for (const extra of [
			{ smRepetition: 5 },
			{ topicId: unknownId },
			{ nextReviewAt: new Date().toISOString() },
		]) {
			expect((await app.post(url).send({ ...base, ...extra })).status).toBe(400);
		}
		expect((await app.post(url).send({ front: '', back: 'a' })).status).toBe(400);
		expect((await app.post(url).send({ ...base, estimatedMinutes: 121 })).status).toBe(400);
		expect((await app.post(url).send({ ...base, priorityWeight: 0 })).status).toBe(400);
		expect((await app.post(url).send({ ...base, priorityWeight: 11 })).status).toBe(400);
	});

	it('404s on a missing topic or memo', async () => {
		const { app, url } = await setup();
		await using _ = app;
		const body = { front: 'q', back: 'a' };
		expect((await app.post(`/api/v1/topics/${unknownId}/cards`).send(body)).status).toBe(404);
		expect((await app.get(`/api/v1/topics/${unknownId}/cards`)).status).toBe(404);

		const missingMemo = await app.post(url).send({ ...body, memoId: unknownId });
		expect(missingMemo.status).toBe(404);
		expect(missingMemo.body.details).toMatchObject({ resource: 'memo' });

		const memo = (await app.post('/api/v1/memos').send({ title: 'm' })).body;
		const linked = await app.post(url).send({ ...body, memoId: memo.id });
		expect(linked.status).toBe(201);
		expect(linked.body.memoId).toBe(memo.id);
	});

	it('lists with pagination in creation order', async () => {
		const { app, url } = await setup();
		await using _ = app;
		for (const front of ['a', 'b', 'c']) await app.post(url).send({ front, back: 'x' });

		const res = await app.get(`${url}?limit=2&offset=1`);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ total: 3, limit: 2, offset: 1 });
		expect(res.body.items.map((c: { front: string }) => c.front)).toEqual(['b', 'c']);
	});

	it('reads, updates and deletes', async () => {
		const { app, url } = await setup();
		await using _ = app;
		const card = (await app.post(url).send({ front: 'q', back: 'a' })).body;

		expect((await app.get(`/api/v1/cards/${card.id}`)).body).toEqual(card);

		const patched = await app
			.patch(`/api/v1/cards/${card.id}`)
			.send({ back: 'b', priorityWeight: 3 });
		expect(patched.status).toBe(200);
		expect(patched.body).toMatchObject({ front: 'q', back: 'b', priorityWeight: 3 });

		expect((await app.patch(`/api/v1/cards/${card.id}`).send({})).status).toBe(400);
		expect((await app.patch(`/api/v1/cards/${card.id}`).send({ smRepetition: 9 })).status).toBe(
			400,
		);
		expect((await app.patch(`/api/v1/cards/${card.id}`).send({ memoId: unknownId })).status).toBe(
			404,
		);
		expect((await app.patch(`/api/v1/cards/${unknownId}`).send({ front: 'x' })).status).toBe(404);

		expect((await app.delete(`/api/v1/cards/${card.id}`)).status).toBe(204);
		expect((await app.get(`/api/v1/cards/${card.id}`)).status).toBe(404);
		expect((await app.delete(`/api/v1/cards/${card.id}`)).status).toBe(404);
	});

	it('takes nextReviewAt and timestamps from the clock', async () => {
		const created = new Date('2031-03-04T05:06:07.000Z');
		const later = new Date('2031-03-09T10:11:12.000Z');
		await using app = await buildTestApp({ now: created });
		const topicId = (await app.post('/api/v1/topics').send({ title: 'T' })).body.id as string;

		const card = (await app.post(`/api/v1/topics/${topicId}/cards`).send({ front: 'q', back: 'a' }))
			.body;
		expect(card.nextReviewAt).toBe(created.toISOString());
		expect(card.createdAt).toBe(created.toISOString());
		expect(card.updatedAt).toBe(created.toISOString());

		app.clock.set(later);
		const patched = (await app.patch(`/api/v1/cards/${card.id}`).send({ back: 'b' })).body;
		expect(patched.updatedAt).toBe(later.toISOString());
		expect(patched.createdAt).toBe(created.toISOString());
		expect(patched.nextReviewAt).toBe(created.toISOString());
	});
});
