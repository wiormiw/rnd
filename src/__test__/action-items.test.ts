import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers.js';

const unknownId = '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10';

async function setup() {
	const app = await buildTestApp();
	const topicId = (await app.post('/api/v1/topics').send({ title: 'T' })).body.id as string;
	const fail = async (front: string) => {
		const card = (await app.post(`/api/v1/topics/${topicId}/cards`).send({ front, back: 'b' }))
			.body;
		app.clock.set(new Date(app.clock.now().getTime() + 1000));
		return (
			await app
				.post(`/api/v1/cards/${card.id}/review`)
				.send({ qualityScore: 0, timeSpentSeconds: 1 })
		).body.actionItem as { id: string };
	};
	return { app, fail };
}

describe('action items', () => {
	it('lists newest first, filters by status and paginates', async () => {
		const { app, fail } = await setup();
		await using _ = app;
		const a = await fail('a');
		const b = await fail('b');
		const c = await fail('c');
		await app.post(`/api/v1/action-items/${a.id}/complete`);

		const all = (await app.get('/api/v1/action-items')).body;
		expect(all.items.map((i: { id: string }) => i.id)).toEqual([c.id, b.id, a.id]);
		expect(all.total).toBe(3);

		const pending = (await app.get('/api/v1/action-items?status=PENDING')).body;
		expect(pending.items.map((i: { id: string }) => i.id)).toEqual([c.id, b.id]);
		const done = (await app.get('/api/v1/action-items?status=DONE')).body;
		expect(done.items.map((i: { id: string }) => i.id)).toEqual([a.id]);

		const page = (await app.get('/api/v1/action-items?limit=1&offset=1')).body;
		expect(page).toMatchObject({ total: 3, limit: 1, offset: 1 });
		expect(page.items[0].id).toBe(b.id);
	});

	it('rejects a bad status or id, and 404s an unknown item', async () => {
		const { app } = await setup();
		await using _ = app;
		expect((await app.get('/api/v1/action-items?status=OPEN')).status).toBe(400);
		expect((await app.post('/api/v1/action-items/nope/complete')).status).toBe(400);
		expect((await app.post(`/api/v1/action-items/${unknownId}/complete`)).status).toBe(404);
	});

	it('completing twice conflicts', async () => {
		const { app, fail } = await setup();
		await using _ = app;
		const item = await fail('a');
		expect((await app.post(`/api/v1/action-items/${item.id}/complete`)).status).toBe(200);
		const again = await app.post(`/api/v1/action-items/${item.id}/complete`);
		expect(again.status).toBe(409);
		expect(again.body.message).toBe('action item already completed');
	});

	it('a pending action item keeps its topic from being mastered', async () => {
		const { app, fail } = await setup();
		await using _ = app;
		const item = await fail('a');
		const [topic] = (await app.get('/api/v1/topics')).body;
		expect(topic.mastered).toBe(false);
		await app.post(`/api/v1/action-items/${item.id}/complete`);
		expect((await app.get(`/api/v1/topics/${topic.id}`)).body.mastered).toBe(false); // repetition 0
	});
});
