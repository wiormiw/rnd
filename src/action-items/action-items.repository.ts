import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import type { Database } from '../database/client.js';
import { DATABASE_TOKEN } from '../database/database.service.js';
import { actionItems, cards } from '../database/schema.js';
import type { ActionItem, ActionItemListQuery } from './action-item.schema.js';

export type CompleteOutcome =
	| { kind: 'not_found' }
	| { kind: 'already_done' }
	| { kind: 'ok'; item: ActionItem };

/** Persistence only. */
@Injectable()
export class ActionItemsRepository {
	constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

	async list({
		status,
		limit,
		offset,
	}: ActionItemListQuery): Promise<{ items: ActionItem[]; total: number }> {
		const where = status ? eq(actionItems.status, status) : undefined;
		const [items, [totals]] = await Promise.all([
			this.db
				.select()
				.from(actionItems)
				.where(where)
				.orderBy(desc(actionItems.spawnedAt), desc(actionItems.id))
				.limit(limit)
				.offset(offset),
			this.db.select({ total: count() }).from(actionItems).where(where),
		]);
		return { items, total: totals?.total ?? 0 };
	}

	/**
	 * One transaction: lock the item, mark it DONE and put its card straight back
	 * into rotation (`nextReviewAt = now`).
	 */
	async complete(id: string, now: Date): Promise<CompleteOutcome> {
		return this.db.transaction(async (tx) => {
			const [item] = await tx
				.select()
				.from(actionItems)
				.where(eq(actionItems.id, id))
				.for('update');
			if (!item) return { kind: 'not_found' };
			if (item.status === 'DONE') return { kind: 'already_done' };

			const [done] = await tx
				.update(actionItems)
				.set({ status: 'DONE', completedAt: now })
				.where(and(eq(actionItems.id, id), eq(actionItems.status, 'PENDING')))
				.returning();
			if (!done) throw new Error('locked action item could not be completed');
			await tx
				.update(cards)
				.set({ nextReviewAt: now, updatedAt: now })
				.where(eq(cards.id, item.cardId));
			return { kind: 'ok', item: done };
		});
	}
}
