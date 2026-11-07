import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

const unknownId = '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10';

async function topic(app: App, title: string): Promise<{ id: string }> {
	const res = await app.post('/api/v1/topics').send({ title });
	expect(res.status).toBe(201);
	return res.body;
}

async function card(app: App, topicId: string): Promise<{ id: string }> {
	const res = await app.post(`/api/v1/topics/${topicId}/cards`).send({ front: 'q', back: 'a' });
	return res.body;
}

const put = (app: App, id: string, prereq: string) =>
	app.put(`/api/v1/topics/${id}/prerequisites/${prereq}`);

describe('api prefix', () => {
	it('serves routes under /api/v1 and keeps health at the root', async () => {
		await using app = await buildTestApp();
		expect((await app.get('/memos')).status).toBe(404);
		expect((await app.get('/api/v1/memos')).status).toBe(200);
		expect((await app.get('/health')).status).toBe(200);
		expect((await app.get('/health/ready')).status).toBe(200);
	});
});

describe('topics', () => {
	it('creates, reads, lists, updates and deletes', async () => {
		await using app = await buildTestApp();
		const created = await app.post('/api/v1/topics').send({ title: '  Algebra ' });
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			title: 'Algebra',
			description: '',
			prerequisiteIds: [],
			cardCount: 0,
			mastered: true,
			unlocked: true,
		});
		const id = created.body.id;

		expect((await app.get(`/api/v1/topics/${id}`)).body).toEqual(created.body);
		expect((await app.get('/api/v1/topics')).body).toEqual([created.body]);

		const patched = await app.patch(`/api/v1/topics/${id}`).send({ description: 'x' });
		expect(patched.status).toBe(200);
		expect(patched.body).toMatchObject({ title: 'Algebra', description: 'x' });

		expect((await app.delete(`/api/v1/topics/${id}`)).status).toBe(204);
		expect((await app.get(`/api/v1/topics/${id}`)).status).toBe(404);
	});

	it('validates input and 404s on unknown ids', async () => {
		await using app = await buildTestApp();
		expect((await app.post('/api/v1/topics').send({ title: '   ' })).status).toBe(400);
		expect((await app.post('/api/v1/topics').send({ title: 'a', extra: 1 })).status).toBe(400);
		expect((await app.patch(`/api/v1/topics/${unknownId}`).send({})).status).toBe(400);
		expect((await app.patch(`/api/v1/topics/${unknownId}`).send({ title: 'x' })).status).toBe(404);
		expect((await app.get(`/api/v1/topics/${unknownId}`)).status).toBe(404);
		expect((await app.delete(`/api/v1/topics/${unknownId}`)).status).toBe(404);
		expect((await app.get('/api/v1/topics/nope')).status).toBe(400);
	});
});

describe('prerequisites', () => {
	it('adds idempotently and removes', async () => {
		await using app = await buildTestApp();
		const a = await topic(app, 'A');
		const b = await topic(app, 'B');

		expect((await put(app, b.id, a.id)).status).toBe(204);
		expect((await put(app, b.id, a.id)).status).toBe(204);
		expect((await app.get(`/api/v1/topics/${b.id}`)).body.prerequisiteIds).toEqual([a.id]);

		expect((await app.delete(`/api/v1/topics/${b.id}/prerequisites/${a.id}`)).status).toBe(204);
		expect((await app.delete(`/api/v1/topics/${b.id}/prerequisites/${a.id}`)).status).toBe(404);
		expect((await app.get(`/api/v1/topics/${b.id}`)).body.prerequisiteIds).toEqual([]);
	});

	it('rejects a self edge with the cycle', async () => {
		await using app = await buildTestApp();
		const a = await topic(app, 'A');
		const res = await put(app, a.id, a.id);
		expect(res.status).toBe(409);
		expect(res.body.details).toEqual({ cycle: [a.id, a.id] });
	});

	it('rejects an indirect cycle with the exact path', async () => {
		await using app = await buildTestApp();
		const a = await topic(app, 'A');
		const b = await topic(app, 'B');
		const c = await topic(app, 'C');
		// B depends on A, C depends on B; making A depend on C closes the loop.
		expect((await put(app, b.id, a.id)).status).toBe(204);
		expect((await put(app, c.id, b.id)).status).toBe(204);

		const res = await put(app, a.id, c.id);
		expect(res.status).toBe(409);
		expect(res.body.details).toEqual({ cycle: [a.id, c.id, b.id, a.id] });
	});

	it('404s when either topic is missing', async () => {
		await using app = await buildTestApp();
		const a = await topic(app, 'A');
		const first = await put(app, unknownId, a.id);
		expect(first.status).toBe(404);
		expect(first.body.details).toMatchObject({ id: unknownId });
		const second = await put(app, a.id, unknownId);
		expect(second.status).toBe(404);
		expect(second.body.details).toMatchObject({ resource: 'prerequisite topic', id: unknownId });
	});
});

describe('status', () => {
	it('locks a dependent until its prerequisite is mastered', async () => {
		await using app = await buildTestApp();
		const a = await topic(app, 'A');
		const b = await topic(app, 'B');
		await put(app, b.id, a.id);
		const c = await card(app, a.id);

		const before = (await app.get('/api/v1/topics')).body;
		expect(before[0]).toMatchObject({ id: a.id, cardCount: 1, mastered: false, unlocked: true });
		expect(before[1]).toMatchObject({ id: b.id, mastered: true, unlocked: false });

		app.store.cards.set(c.id, { ...app.store.cards.get(c.id)!, smRepetition: 2 });
		const after = (await app.get('/api/v1/topics')).body;
		expect(after[0]).toMatchObject({ id: a.id, mastered: true });
		expect(after[1]).toMatchObject({ id: b.id, unlocked: true });
	});

	it('treats an empty topic as mastered', async () => {
		await using app = await buildTestApp();
		const a = await topic(app, 'A');
		const b = await topic(app, 'B');
		await put(app, b.id, a.id);
		expect((await app.get(`/api/v1/topics/${a.id}`)).body.mastered).toBe(true);
		expect((await app.get(`/api/v1/topics/${b.id}`)).body.unlocked).toBe(true);
	});

	it('a pending action item blocks mastery', async () => {
		await using app = await buildTestApp();
		const a = await topic(app, 'A');
		const c = await card(app, a.id);
		app.store.cards.set(c.id, { ...app.store.cards.get(c.id)!, smRepetition: 3 });
		expect((await app.get(`/api/v1/topics/${a.id}`)).body.mastered).toBe(true);

		app.store.actionItems.set('item', {
			id: 'item',
			cardId: c.id,
			title: 'Practice',
			status: 'PENDING',
			spawnedAt: new Date(),
			completedAt: null,
		});
		expect((await app.get(`/api/v1/topics/${a.id}`)).body.mastered).toBe(false);
	});
});

describe('GET /curriculum/order', () => {
	it('lists prerequisites before dependents', async () => {
		await using app = await buildTestApp();
		const a = await topic(app, 'A');
		const b = await topic(app, 'B');
		const c = await topic(app, 'C');
		await put(app, a.id, c.id);
		await put(app, c.id, b.id);

		const res = await app.get('/api/v1/curriculum/order');
		expect(res.status).toBe(200);
		expect(res.body.map((t: { id: string }) => t.id)).toEqual([b.id, c.id, a.id]);
		expect(res.body[0]).toHaveProperty('unlocked');
	});
});
