import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lte, notExists } from 'drizzle-orm';
import type { Database } from '../database/client.js';
import { DATABASE_TOKEN } from '../database/database.service.js';
import { actionItems, cards } from '../database/schema.js';
import type { DueCard } from './schedule.schema.js';

/** Persistence only. */
@Injectable()
export class ScheduleRepository {
	constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

	/** Cards due at `now` that are not waiting on a pending practice task. */
	async dueCards(now: Date): Promise<DueCard[]> {
		return this.db
			.select({
				id: cards.id,
				topicId: cards.topicId,
				front: cards.front,
				back: cards.back,
				estimatedMinutes: cards.estimatedMinutes,
				priorityWeight: cards.priorityWeight,
				smInterval: cards.smInterval,
				nextReviewAt: cards.nextReviewAt,
			})
			.from(cards)
			.where(
				and(
					lte(cards.nextReviewAt, now),
					notExists(
						this.db
							.select({ one: actionItems.id })
							.from(actionItems)
							.where(and(eq(actionItems.cardId, cards.id), eq(actionItems.status, 'PENDING'))),
					),
				),
			);
	}
}
