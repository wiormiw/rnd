import { Inject, Injectable } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
import type { Database } from '../database/client.js';
import { DATABASE_TOKEN } from '../database/database.service.js';
import { cards, memos, topics } from '../database/schema.js';
import type { Pagination } from '../common/schemas.js';
import type { Card, CardInsert, CardUpdate } from './card.schema.js';

/** Persistence only: "not found" is `undefined` / `false`. */
@Injectable()
export class CardsRepository {
	constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

	async insert(topicId: string, input: CardInsert): Promise<Card> {
		const [row] = await this.db
			.insert(cards)
			.values({ ...input, topicId })
			.returning();
		if (!row) throw new Error('insert into cards returned no row');
		return row;
	}

	async findById(id: string): Promise<Card | undefined> {
		const [row] = await this.db.select().from(cards).where(eq(cards.id, id)).limit(1);
		return row;
	}

	async update(id: string, patch: CardUpdate): Promise<Card | undefined> {
		const [row] = await this.db.update(cards).set(patch).where(eq(cards.id, id)).returning();
		return row;
	}

	async remove(id: string): Promise<boolean> {
		const deleted = await this.db.delete(cards).where(eq(cards.id, id)).returning({ id: cards.id });
		return deleted.length > 0;
	}

	async listByTopic(
		topicId: string,
		{ limit, offset }: Pagination,
	): Promise<{ items: Card[]; total: number }> {
		const [items, [totals]] = await Promise.all([
			this.db
				.select()
				.from(cards)
				.where(eq(cards.topicId, topicId))
				.orderBy(asc(cards.createdAt), asc(cards.id))
				.limit(limit)
				.offset(offset),
			this.db.select({ total: count() }).from(cards).where(eq(cards.topicId, topicId)),
		]);
		return { items, total: totals?.total ?? 0 };
	}

	async memoExists(id: string): Promise<boolean> {
		const rows = await this.db
			.select({ id: memos.id })
			.from(memos)
			.where(eq(memos.id, id))
			.limit(1);
		return rows.length > 0;
	}

	async topicExists(id: string): Promise<boolean> {
		const rows = await this.db
			.select({ id: topics.id })
			.from(topics)
			.where(eq(topics.id, id))
			.limit(1);
		return rows.length > 0;
	}
}
