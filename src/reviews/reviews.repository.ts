import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import type { Card } from '../cards/card.schema.js';
import type { ActionItem } from '../action-items/action-item.schema.js';
import type { Database } from '../database/client.js';
import { DATABASE_TOKEN } from '../database/database.service.js';
import { actionItems, cards, reviewLogs } from '../database/schema.js';
import type { Pagination } from '../common/schemas.js';
import type { ReviewDecision } from '../engines/index.js';
import type { ReviewLog } from './review.schema.js';

export type ApplyReviewOutcome =
	| { kind: 'not_found' }
	| { kind: 'pending'; actionItemId: string }
	| { kind: 'ok'; card: Card; actionItem: ActionItem | null };

/** Persistence only. */
@Injectable()
export class ReviewsRepository {
	constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

	/**
	 * One transaction: lock the card, refuse while a practice task is pending,
	 * then log the review, spawn the action item and move the card's schedule.
	 * `decide` must be pure: it runs while the row lock is held.
	 */
	async applyReview(
		cardId: string,
		decide: (card: Card) => ReviewDecision,
	): Promise<ApplyReviewOutcome> {
		return this.db.transaction(async (tx) => {
			const [card] = await tx.select().from(cards).where(eq(cards.id, cardId)).for('update');
			if (!card) return { kind: 'not_found' };

			const [pending] = await tx
				.select({ id: actionItems.id })
				.from(actionItems)
				.where(and(eq(actionItems.cardId, cardId), eq(actionItems.status, 'PENDING')))
				.limit(1);
			if (pending) return { kind: 'pending', actionItemId: pending.id };

			const { sm2, log, actionItemTitle } = decide(card);
			await tx.insert(reviewLogs).values({ ...log, cardId });

			let actionItem: ActionItem | null = null;
			if (actionItemTitle !== null) {
				const [created] = await tx
					.insert(actionItems)
					.values({ cardId, title: actionItemTitle, spawnedAt: log.reviewedAt })
					.returning();
				actionItem = created ?? null;
			}

			const [updated] = await tx
				.update(cards)
				.set({
					smInterval: sm2.interval,
					smRepetition: sm2.repetition,
					smEaseFactor: sm2.easeFactor,
					nextReviewAt: sm2.nextReviewAt,
					updatedAt: log.reviewedAt,
				})
				.where(eq(cards.id, cardId))
				.returning();
			if (!updated) throw new Error('locked card could not be updated');
			return { kind: 'ok', card: updated, actionItem };
		});
	}

	async cardExists(id: string): Promise<boolean> {
		const rows = await this.db
			.select({ id: cards.id })
			.from(cards)
			.where(eq(cards.id, id))
			.limit(1);
		return rows.length > 0;
	}

	async listByCard(
		cardId: string,
		{ limit, offset }: Pagination,
	): Promise<{ items: ReviewLog[]; total: number }> {
		const [items, [totals]] = await Promise.all([
			this.db
				.select()
				.from(reviewLogs)
				.where(eq(reviewLogs.cardId, cardId))
				.orderBy(desc(reviewLogs.reviewedAt), desc(reviewLogs.id))
				.limit(limit)
				.offset(offset),
			this.db.select({ total: count() }).from(reviewLogs).where(eq(reviewLogs.cardId, cardId)),
		]);
		return { items, total: totals?.total ?? 0 };
	}
}
