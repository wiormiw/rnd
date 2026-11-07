import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../engines/index.js';
import { buildTestApp } from './helpers.js';

const unknownId = '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10';
const T0 = new Date(Date.UTC(2026, 5, 1, 9));

async function setup() {
	const app = await buildTestApp({ now: T0 });
	const topicId = (await app.post('/api/v1/topics').send({ title: 'T' })).body.id as string;
	const card = (
		await app.post(`/api/v1/topics/${topicId}/cards`).send({ front: 'What is 2+2?', back: '4' })
	).body;
	return { app, topicId, card, review: `/api/v1/cards/${card.id}/review` };
}

const body = (qualityScore: number) => ({ qualityScore, timeSpentSeconds: 12 });

describe('POST /cards/:id/review', () => {
	it('grows the interval 1 -> 6 -> round(6 * EF) and schedules from the clock', async () => {
		const { app, card, review } = await setup();
		await using _ = app;
		const seen: { interval: number; ef: number }[] = [];

		for (const expectedInterval of [1, 6, undefined]) {
			const res = await app.post(review).send(body(5));
			expect(res.status).toBe(200);
			const { smInterval, smEaseFactor } = res.body.card;
			if (expectedInterval === undefined) {
				expect(smInterval).toBe(Math.round(6 * smEaseFactor));
			} else {
				expect(smInterval).toBe(expectedInterval);
			}
			expect(res.body.actionItem).toBeNull();
			expect(res.body.nextReviewAt).toBe(
				new Date(T0.getTime() + smInterval * DAY_MS).toISOString(),
			);
			expect(res.body.card.nextReviewAt).toBe(res.body.nextReviewAt);
			seen.push({ interval: smInterval, ef: smEaseFactor });
		}
		expect(seen[2]!.interval).toBeGreaterThan(6);

		const logs = (await app.get(`/api/v1/cards/${card.id}/reviews`)).body;
		expect(logs.total).toBe(3);
		// newest first
		expect(logs.items[0]).toMatchObject({
			cardId: card.id,
			qualityScore: 5,
			timeSpentSeconds: 12,
			previousInterval: 6,
			newInterval: seen[2]!.interval,
			previousEaseFactor: seen[1]!.ef,
			newEaseFactor: seen[2]!.ef,
			reviewedAt: T0.toISOString(),
		});
		expect(logs.items[2]).toMatchObject({
			previousInterval: 0,
			newInterval: 1,
			previousEaseFactor: 2.5,
		});
	});

	it('uses the clock at the time of each review', async () => {
		const { app, review } = await setup();
		await using _ = app;
		const later = new Date(T0.getTime() + 3 * DAY_MS);
		app.clock.set(later);
		const res = await app.post(review).send(body(4));
		expect(res.body.nextReviewAt).toBe(new Date(later.getTime() + DAY_MS).toISOString());
	});

	it('q=2 resets SM-2 without spawning an action item', async () => {
		const { app, review } = await setup();
		await using _ = app;
		await app.post(review).send(body(5));
		await app.post(review).send(body(5));
		const res = await app.post(review).send(body(2));
		expect(res.status).toBe(200);
		expect(res.body.actionItem).toBeNull();
		expect(res.body.card).toMatchObject({ smInterval: 1, smRepetition: 0 });
		expect((await app.get('/api/v1/action-items')).body.total).toBe(0);
	});

	it('404s for a missing card', async () => {
		await using app = await buildTestApp();
		expect((await app.post(`/api/v1/cards/${unknownId}/review`).send(body(3))).status).toBe(404);
		expect((await app.get(`/api/v1/cards/${unknownId}/reviews`)).status).toBe(404);
	});

	it('400s on bad input', async () => {
		const { app, review } = await setup();
		await using _ = app;
		const bad = [
			body(6),
			body(-1),
			{ qualityScore: 3.5, timeSpentSeconds: 1 },
			{ qualityScore: 3 },
			{ timeSpentSeconds: 3 },
			{ qualityScore: 3, timeSpentSeconds: -1 },
			{ qualityScore: 3, timeSpentSeconds: 86_401 },
			{ ...body(3), extra: true },
			{},
		];
		for (const payload of bad) expect((await app.post(review).send(payload)).status).toBe(400);
		expect((await app.post('/api/v1/cards/nope/review').send(body(3))).status).toBe(400);
		expect((await app.get('/api/v1/cards/nope/reviews')).status).toBe(400);
		expect((await app.get('/api/v1/cards/nope/reviews?limit=0')).status).toBe(400);
	});

	it('paginates review history', async () => {
		const { app, card, review } = await setup();
		await using _ = app;
		for (const q of [3, 4, 5]) await app.post(review).send(body(q));
		const res = await app.get(`/api/v1/cards/${card.id}/reviews?limit=1&offset=1`);
		expect(res.body).toMatchObject({ total: 3, limit: 1, offset: 1 });
		expect(res.body.items.map((l: { qualityScore: number }) => l.qualityScore)).toEqual([4]);
	});

	it('runs the full remediation loop', async () => {
		const { app, card, review } = await setup();
		await using _ = app;
		const sprint = async () =>
			(await app.get('/api/v1/schedule/daily')).body.items.map(
				(i: { card: { id: string } }) => i.card.id,
			);
		expect(await sprint()).toEqual([card.id]);

		const first = await app.post(review).send(body(1));
		expect(first.status).toBe(200);
		expect(first.body.actionItem).toMatchObject({
			cardId: card.id,
			title: 'Practice: What is 2+2?',
			status: 'PENDING',
			completedAt: null,
		});
		expect(first.body.card).toMatchObject({ smInterval: 1, smRepetition: 0 });
		expect(await sprint()).toEqual([]);

		const blocked = await app.post(review).send(body(5));
		expect(blocked.status).toBe(409);
		expect(blocked.body.details).toEqual({ actionItemId: first.body.actionItem.id });
		expect((await app.get(`/api/v1/cards/${card.id}/reviews`)).body.total).toBe(1);

		// The card is due again the day after, but still hidden while the task is open.
		app.clock.set(new Date(T0.getTime() + 2 * DAY_MS));
		expect(await sprint()).toEqual([]);

		const completeAt = new Date(T0.getTime() + 3 * DAY_MS);
		app.clock.set(completeAt);
		const done = await app.post(`/api/v1/action-items/${first.body.actionItem.id}/complete`);
		expect(done.status).toBe(200);
		expect(done.body).toMatchObject({ status: 'DONE', completedAt: completeAt.toISOString() });
		expect((await app.get(`/api/v1/cards/${card.id}`)).body.nextReviewAt).toBe(
			completeAt.toISOString(),
		);
		expect(await sprint()).toEqual([card.id]);

		const again = await app.post(`/api/v1/action-items/${first.body.actionItem.id}/complete`);
		expect(again.status).toBe(409);
		expect((await app.post(review).send(body(4))).status).toBe(200);
	});

	it('truncates long fronts in the practice title', async () => {
		const { app, topicId } = await setup();
		await using _ = app;
		const long = (
			await app.post(`/api/v1/topics/${topicId}/cards`).send({ front: 'x'.repeat(500), back: 'a' })
		).body;
		const res = await app.post(`/api/v1/cards/${long.id}/review`).send(body(0));
		expect(res.body.actionItem.title).toBe(`Practice: ${'x'.repeat(180)}`);
	});
});
