import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../engines/index.js';
import { buildTestApp } from './helpers.js';

type App = Awaited<ReturnType<typeof buildTestApp>>;

const T0 = new Date(Date.UTC(2026, 5, 1, 9));
const daily = '/api/v1/schedule/daily';

async function topic(app: App, title: string) {
	return (await app.post('/api/v1/topics').send({ title })).body.id as string;
}

async function card(app: App, topicId: string, extra: Record<string, unknown> = {}) {
	return (
		await app.post(`/api/v1/topics/${topicId}/cards`).send({ front: 'f', back: 'b', ...extra })
	).body.id as string;
}

const ids = (res: { body: { items: { card: { id: string } }[] } }) =>
	res.body.items.map((i) => i.card.id);

function setCard(app: App, id: string, patch: Record<string, unknown>) {
	app.store.cards.set(id, { ...app.store.cards.get(id)!, ...patch });
}

describe('GET /schedule/daily', () => {
	it('returns the sprint envelope with default maxMinutes 45', async () => {
		await using app = await buildTestApp({ now: T0 });
		const t = await topic(app, 'A');
		const id = await card(app, t, { estimatedMinutes: 5 });
		const res = await app.get(daily);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			generatedAt: T0.toISOString(),
			maxMinutes: 45,
			totalCards: 1,
			allocatedMinutes: 5,
		});
		expect(res.body.items).toEqual([
			{
				card: { id, topicId: t, front: 'f', back: 'b', estimatedMinutes: 5 },
				urgency: expect.any(Number),
			},
		]);
	});

	it('includes only due cards', async () => {
		await using app = await buildTestApp({ now: T0 });
		const t = await topic(app, 'A');
		const due = await card(app, t);
		const later = await card(app, t);
		setCard(app, later, { nextReviewAt: new Date(T0.getTime() + DAY_MS) });
		expect(ids(await app.get(daily))).toEqual([due]);

		app.clock.set(new Date(T0.getTime() + DAY_MS));
		expect(ids(await app.get(daily))).toHaveLength(2);
	});

	it('hides cards of locked topics until the prerequisite is mastered', async () => {
		await using app = await buildTestApp({ now: T0 });
		const a = await topic(app, 'A');
		const b = await topic(app, 'B');
		await app.put(`/api/v1/topics/${b}/prerequisites/${a}`);
		const cardA = await card(app, a);
		const cardB = await card(app, b);

		expect(ids(await app.get(daily))).toEqual([cardA]);

		// Two successful reviews master A (repetition >= 2)...
		const review = { qualityScore: 5, timeSpentSeconds: 1 };
		await app.post(`/api/v1/cards/${cardA}/review`).send(review);
		app.clock.set(new Date(T0.getTime() + 2 * DAY_MS));
		await app.post(`/api/v1/cards/${cardA}/review`).send(review);
		expect(ids(await app.get(daily))).toEqual([cardB]);
	});

	it('respects maxMinutes and prefers the more overdue card when time is short', async () => {
		await using app = await buildTestApp({ now: T0 });
		const t = await topic(app, 'A');
		const slightly = await card(app, t, { estimatedMinutes: 10 });
		const very = await card(app, t, { estimatedMinutes: 10 });
		setCard(app, slightly, { smInterval: 2, nextReviewAt: new Date(T0.getTime() - DAY_MS) });
		setCard(app, very, { smInterval: 2, nextReviewAt: new Date(T0.getTime() - 20 * DAY_MS) });

		const res = await app.get(`${daily}?maxMinutes=10`);
		expect(ids(res)).toEqual([very]);
		expect(res.body.allocatedMinutes).toBeLessThanOrEqual(10);
		expect(res.body.maxMinutes).toBe(10);

		const roomy = await app.get(`${daily}?maxMinutes=20`);
		expect(roomy.body.totalCards).toBe(2);
		expect(roomy.body.allocatedMinutes).toBe(20);
	});

	it('returns an empty sprint when nothing fits', async () => {
		await using app = await buildTestApp({ now: T0 });
		const t = await topic(app, 'A');
		await card(app, t, { estimatedMinutes: 30 });
		const res = await app.get(`${daily}?maxMinutes=5`);
		expect(res.body).toMatchObject({ totalCards: 0, allocatedMinutes: 0, items: [] });
	});

	it('400s on out-of-range maxMinutes', async () => {
		await using app = await buildTestApp();
		for (const v of ['0', '481', '-3', 'abc', '2.5']) {
			expect((await app.get(`${daily}?maxMinutes=${v}`)).status).toBe(400);
		}
		expect((await app.get(`${daily}?maxMinutes=1`)).status).toBe(200);
		expect((await app.get(`${daily}?maxMinutes=480`)).status).toBe(200);
	});
});
