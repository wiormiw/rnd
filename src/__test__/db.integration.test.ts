import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ActionItemsRepository } from '../action-items/action-items.repository.js';
import { CardsRepository } from '../cards/cards.repository.js';
import { createSilentLogger } from '../common/logger.js';
import { CurriculumRepository } from '../curriculum/curriculum.repository.js';
import { createDatabase } from '../database/client.js';
import {
	actionItems,
	cards,
	memos,
	reviewLogs,
	topicPrerequisites,
	topics,
} from '../database/schema.js';
import { calculateSM2, wouldCreateCycle } from '../engines/index.js';
import { loadConfig } from '../lib/config.js';
import { MemosRepository } from '../memos/memos.repository.js';
import { ReviewsRepository, type ReviewDecision } from '../reviews/reviews.repository.js';
import { ScheduleRepository } from '../schedule/schedule.repository.js';
import { testEnv } from './helpers.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs against a REAL, already-migrated Postgres, so it is opt-in:
 *
 *   pnpm infra:up
 *   DB_URL=postgres://rnd:rnd@localhost:5432/rnd pnpm db:migrate
 *   DB_TEST_URL=postgres://rnd:rnd@localhost:5432/rnd pnpm test db.integration
 *
 * The database is shared, so every test creates its own uniquely named topics
 * and deletes them afterwards (cascades remove cards, logs and items).
 */
const url = process.env['DB_TEST_URL'];

/** Walks the `cause` chain: Drizzle wraps the driver error. */
function pgCode(error: unknown): string | undefined {
	for (let e = error; e instanceof Error; e = e.cause) {
		const code = (e as { code?: unknown }).code;
		if (typeof code === 'string') return code;
	}
	return undefined;
}

async function pgCodeOf(promise: PromiseLike<unknown>): Promise<string | undefined> {
	try {
		await promise;
	} catch (error) {
		return pgCode(error);
	}
	return undefined;
}

describe.skipIf(!url)('repositories on a real Postgres', () => {
	const env = loadConfig({ ...testEnv, DB_URL: url ?? testEnv.DB_URL });
	const database = createDatabase(env, createSilentLogger());
	const { db } = database;
	const curriculum = new CurriculumRepository(db);
	const cardsRepo = new CardsRepository(db);
	const memosRepo = new MemosRepository(db);
	const reviews = new ReviewsRepository(db);
	const actionItemsRepo = new ActionItemsRepository(db);
	const schedule = new ScheduleRepository(db);

	const topicIds: string[] = [];
	const memoIds: string[] = [];
	const run = randomUUID();

	const makeTopic = async () => {
		const topic = await curriculum.insertTopic(
			{ title: `it-${run}-${randomUUID()}`, description: '' },
			new Date(),
		);
		topicIds.push(topic.id);
		return topic;
	};

	const makeCard = async (topicId: string, nextReviewAt?: Date) => {
		const card = await cardsRepo.insert(
			topicId,
			{ front: 'front', back: 'back', memoId: null, estimatedMinutes: 2, priorityWeight: 1 },
			new Date(),
		);
		if (!nextReviewAt) return card;
		const [updated] = await db
			.update(cards)
			.set({ nextReviewAt })
			.where(eq(cards.id, card.id))
			.returning();
		if (!updated) throw new Error('card vanished');
		return updated;
	};

	const decider =
		(quality: number, now: Date, actionItemTitle: string | null) =>
		(card: Parameters<Parameters<ReviewsRepository['applyReview']>[1]>[0]): ReviewDecision => {
			const sm2 = calculateSM2(
				{ interval: card.smInterval, repetition: card.smRepetition, easeFactor: card.smEaseFactor },
				quality,
				now,
			);
			return {
				sm2,
				actionItemTitle,
				log: {
					qualityScore: quality,
					timeSpentSeconds: 30,
					previousInterval: card.smInterval,
					newInterval: sm2.interval,
					previousEaseFactor: card.smEaseFactor,
					newEaseFactor: sm2.easeFactor,
					reviewedAt: now,
				},
			};
		};

	const logCount = async (cardId: string) =>
		(await db.select().from(reviewLogs).where(eq(reviewLogs.cardId, cardId))).length;
	const itemsOf = (cardId: string) =>
		db.select().from(actionItems).where(eq(actionItems.cardId, cardId));

	beforeAll(async () => {
		await database.ping(AbortSignal.timeout(5000));
	});

	afterEach(async () => {
		if (memoIds.length > 0) await db.delete(memos).where(inArray(memos.id, memoIds));
		if (topicIds.length > 0) await db.delete(topics).where(inArray(topics.id, topicIds));
		memoIds.length = 0;
		topicIds.length = 0;
	});

	afterAll(async () => {
		await database[Symbol.asyncDispose]();
	});

	describe('migration shape', () => {
		it('rejects a self prerequisite edge via topic_prerequisites_no_self', async () => {
			const topic = await makeTopic();

			const code = await pgCodeOf(
				db.insert(topicPrerequisites).values({ topicId: topic.id, prerequisiteId: topic.id }),
			);

			expect(code).toBe('23514');
		});

		it('allows one PENDING item per card, but DONE + PENDING together', async () => {
			const topic = await makeTopic();
			const card = await makeCard(topic.id);

			await db.insert(actionItems).values({ cardId: card.id, title: 'first' });
			const duplicate = await pgCodeOf(
				db.insert(actionItems).values({ cardId: card.id, title: 'second' }),
			);
			expect(duplicate).toBe('23505');

			await db.update(actionItems).set({ status: 'DONE' }).where(eq(actionItems.cardId, card.id));
			await db.insert(actionItems).values({ cardId: card.id, title: 'third' });

			const items = await itemsOf(card.id);
			expect(items.map((item) => item.status).sort()).toEqual(['DONE', 'PENDING']);
		});
	});

	describe('applyReview', () => {
		const now = new Date('2030-01-01T00:00:00.000Z');

		it('logs the review, moves the SM-2 state and returns ok', async () => {
			const topic = await makeTopic();
			const card = await makeCard(topic.id);

			const outcome = await reviews.applyReview(card.id, decider(5, now, null));

			expect(outcome.kind).toBe('ok');
			if (outcome.kind !== 'ok') return;
			expect(outcome.actionItem).toBeNull();
			expect(outcome.card.smRepetition).toBe(1);
			expect(outcome.card.smInterval).toBeGreaterThan(0);
			expect(outcome.card.nextReviewAt.getTime()).toBeGreaterThan(now.getTime());

			const stored = await cardsRepo.findById(card.id);
			expect(stored?.smRepetition).toBe(1);
			expect(stored?.smInterval).toBe(outcome.card.smInterval);
			expect(await logCount(card.id)).toBe(1);
		});

		it('returns pending and writes nothing while an action item is pending', async () => {
			const topic = await makeTopic();
			const card = await makeCard(topic.id);
			const [item] = await db
				.insert(actionItems)
				.values({ cardId: card.id, title: 'practice' })
				.returning();

			const outcome = await reviews.applyReview(card.id, decider(5, now, null));

			expect(outcome).toEqual({ kind: 'pending', actionItemId: item?.id });
			expect(await logCount(card.id)).toBe(0);
			expect((await cardsRepo.findById(card.id))?.smRepetition).toBe(0);
		});

		it('returns not_found for an unknown card', async () => {
			const outcome = await reviews.applyReview(randomUUID(), decider(5, now, null));

			expect(outcome).toEqual({ kind: 'not_found' });
		});

		it('spawns exactly one PENDING action item when decide asks for one', async () => {
			const topic = await makeTopic();
			const card = await makeCard(topic.id);

			const outcome = await reviews.applyReview(card.id, decider(1, now, 'redo exercise'));

			expect(outcome.kind).toBe('ok');
			if (outcome.kind !== 'ok') return;
			expect(outcome.actionItem?.title).toBe('redo exercise');
			const items = await itemsOf(card.id);
			expect(items).toHaveLength(1);
			expect(items[0]?.status).toBe('PENDING');
		});

		it('serialises two concurrent reviews: one ok, one pending', async () => {
			const topic = await makeTopic();
			const card = await makeCard(topic.id);

			const outcomes = await Promise.all([
				reviews.applyReview(card.id, decider(1, now, 'redo A')),
				reviews.applyReview(card.id, decider(1, now, 'redo B')),
			]);

			expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['ok', 'pending']);
			const items = await itemsOf(card.id);
			expect(items).toHaveLength(1);
			expect(items[0]?.status).toBe('PENDING');
			expect(await logCount(card.id)).toBe(1);
		});
	});

	describe('applyReview edge cases', () => {
		const now = new Date('2030-01-01T00:00:00.000Z');

		it('stores the SM-2 ease-factor floor of 1.3 exactly (double precision)', async () => {
			const topic = await makeTopic();
			const card = await makeCard(topic.id);
			await db.update(cards).set({ smEaseFactor: 1.3 }).where(eq(cards.id, card.id));
			expect((await cardsRepo.findById(card.id))?.smEaseFactor).toBe(1.3);

			const outcome = await reviews.applyReview(card.id, decider(0, now, null));

			expect(outcome.kind).toBe('ok');
			if (outcome.kind !== 'ok') return;
			expect(outcome.card.smEaseFactor).toBe(1.3);
			expect((await cardsRepo.findById(card.id))?.smEaseFactor).toBe(1.3);
			const [log] = await db.select().from(reviewLogs).where(eq(reviewLogs.cardId, card.id));
			expect(log?.previousEaseFactor).toBe(1.3);
			expect(log?.newEaseFactor).toBe(1.3);
		});

		it('waits on the card row lock, then sees a PENDING item inserted by the lock holder', async () => {
			const topic = await makeTopic();
			const card = await makeCard(topic.id);
			let release: () => void = () => {};
			const hold = new Promise<void>((resolve) => {
				release = resolve;
			});
			let markLocked: () => void = () => {};
			const locked = new Promise<void>((resolve) => {
				markLocked = resolve;
			});

			const holder = db.transaction(async (tx) => {
				await tx.execute(sql`select id from cards where id = ${card.id} for update`);
				markLocked();
				await hold;
				await tx.insert(actionItems).values({ cardId: card.id, title: 'held' });
			});

			try {
				await locked;
				let settled = false;
				const review = reviews.applyReview(card.id, decider(5, now, null)).finally(() => {
					settled = true;
				});

				await sleep(100);
				expect(settled).toBe(false);

				release();
				await holder;

				const outcome = await review;
				expect(outcome.kind).toBe('pending');
				expect(await logCount(card.id)).toBe(0);
			} finally {
				release();
				await holder.catch(() => undefined);
			}
		});
	});

	describe('addPrerequisite', () => {
		it('lets exactly one of two opposing concurrent edges win', async () => {
			const a = await makeTopic();
			const b = await makeTopic();

			const results = await Promise.all([
				curriculum.addPrerequisite(a.id, b.id, (edges) => wouldCreateCycle(edges, a.id, b.id)),
				curriculum.addPrerequisite(b.id, a.id, (edges) => wouldCreateCycle(edges, b.id, a.id)),
			]);

			expect(results.filter((result) => 'added' in result)).toEqual([{ added: true }]);
			expect(results.filter((result) => 'cycle' in result)).toHaveLength(1);

			const edges = (await curriculum.listEdges()).filter(
				(edge) => [a.id, b.id].includes(edge.topicId) && [a.id, b.id].includes(edge.prerequisiteId),
			);
			expect(edges).toHaveLength(1);
		});
	});

	describe('prerequisite edges', () => {
		it('reports added: false for a duplicate edge and keeps a single row', async () => {
			const a = await makeTopic();
			const b = await makeTopic();
			const check = (edges: Parameters<typeof wouldCreateCycle>[0]) =>
				wouldCreateCycle(edges, a.id, b.id);

			expect(await curriculum.addPrerequisite(a.id, b.id, check)).toEqual({ added: true });
			expect(await curriculum.addPrerequisite(a.id, b.id, check)).toEqual({ added: false });

			const rows = await db
				.select()
				.from(topicPrerequisites)
				.where(eq(topicPrerequisites.topicId, a.id));
			expect(rows).toHaveLength(1);
		});
	});

	describe('topic cascade', () => {
		it('deleting a topic removes its cards, review logs and action items', async () => {
			const topic = await makeTopic();
			const card = await makeCard(topic.id);
			const outcome = await reviews.applyReview(
				card.id,
				decider(1, new Date('2030-01-01T00:00:00.000Z'), 'redo'),
			);
			expect(outcome.kind).toBe('ok');

			const cardRows = () => db.select().from(cards).where(eq(cards.topicId, topic.id));
			expect(await cardRows()).toHaveLength(1);
			expect(await logCount(card.id)).toBe(1);
			expect(await itemsOf(card.id)).toHaveLength(1);

			expect(await curriculum.removeTopic(topic.id)).toBe(true);

			expect(await cardRows()).toHaveLength(0);
			expect(await logCount(card.id)).toBe(0);
			expect(await itemsOf(card.id)).toHaveLength(0);
		});
	});

	describe('action item completion', () => {
		it('marks DONE, stamps completedAt, resets the card, and refuses a second completion', async () => {
			const topic = await makeTopic();
			const future = new Date('2040-01-01T00:00:00.000Z');
			const card = await makeCard(topic.id, future);
			const [item] = await db
				.insert(actionItems)
				.values({ cardId: card.id, title: 'practice' })
				.returning();
			if (!item) throw new Error('no item');
			const now = new Date('2030-06-01T12:00:00.000Z');

			const first = await actionItemsRepo.complete(item.id, now);

			expect(first.kind).toBe('ok');
			if (first.kind !== 'ok') return;
			expect(first.item.status).toBe('DONE');
			expect(first.item.completedAt).toEqual(now);
			expect((await cardsRepo.findById(card.id))?.nextReviewAt).toEqual(now);

			expect(await actionItemsRepo.complete(item.id, new Date())).toEqual({ kind: 'already_done' });
			expect(await actionItemsRepo.complete(randomUUID(), now)).toEqual({ kind: 'not_found' });
		});
	});

	describe('dueCards', () => {
		it('excludes future and pending cards, and includes a card once its item is DONE', async () => {
			const topic = await makeTopic();
			const now = new Date('2030-01-01T00:00:00.000Z');
			const past = new Date('2029-12-31T00:00:00.000Z');
			const future = new Date('2030-01-02T00:00:00.000Z');
			const due = await makeCard(topic.id, past);
			const later = await makeCard(topic.id, future);
			const blocked = await makeCard(topic.id, past);
			const [item] = await db
				.insert(actionItems)
				.values({ cardId: blocked.id, title: 'practice' })
				.returning();
			if (!item) throw new Error('no item');

			const mine = async () =>
				(await schedule.dueCards(now)).filter((card) => card.topicId === topic.id).map((c) => c.id);

			const before = await mine();
			expect(before).toContain(due.id);
			expect(before).not.toContain(later.id);
			expect(before).not.toContain(blocked.id);

			await actionItemsRepo.complete(item.id, now);

			expect(await mine()).toContain(blocked.id);
		});
	});

	describe('memo foreign keys', () => {
		it('nulls memo.topicId when its topic is deleted', async () => {
			const topic = await makeTopic();
			const memo = await memosRepo.insert({ title: `memo-${run}`, body: '', topicId: topic.id });
			memoIds.push(memo.id);

			expect(await curriculum.removeTopic(topic.id)).toBe(true);

			expect((await memosRepo.findById(memo.id))?.topicId).toBeNull();
		});

		it('nulls card.memoId when its memo is deleted', async () => {
			const topic = await makeTopic();
			const memo = await memosRepo.insert({ title: `memo-${run}`, body: '', topicId: null });
			memoIds.push(memo.id);
			const card = await cardsRepo.insert(
				topic.id,
				{ front: 'f', back: 'b', memoId: memo.id, estimatedMinutes: 2, priorityWeight: 1 },
				new Date(),
			);
			expect(card.memoId).toBe(memo.id);

			expect(await memosRepo.remove(memo.id)).toBe(true);

			expect((await cardsRepo.findById(card.id))?.memoId).toBeNull();
		});
	});
});
