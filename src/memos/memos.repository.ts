import { Inject, Injectable } from '@nestjs/common';
import { count, desc, eq } from 'drizzle-orm';
import type { Database } from '../database/client.js';
import { DATABASE_TOKEN } from '../database/database.service.js';
import { memos, topics } from '../database/schema.js';
import type { Pagination } from '../common/schemas.js';
import type { Memo, MemoInsert, MemoUpdate } from './memo.schema.js';

/**
 * Persistence only: no business rules, no HTTP, no Results. "Not found" is an
 * ordinary answer here (`undefined` / `false`); the service decides what it
 * means. Infrastructure failures are thrown.
 */
@Injectable()
export class MemosRepository {
	constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

	async insert(input: MemoInsert): Promise<Memo> {
		const [row] = await this.db.insert(memos).values(input).returning();
		if (!row) throw new Error('insert into memos returned no row');
		return row;
	}

	async findById(id: string): Promise<Memo | undefined> {
		const [row] = await this.db.select().from(memos).where(eq(memos.id, id)).limit(1);
		return row;
	}

	/** The updated memo, or `undefined` when no row has that id. */
	async update(id: string, patch: MemoUpdate): Promise<Memo | undefined> {
		const [row] = await this.db.update(memos).set(patch).where(eq(memos.id, id)).returning();
		return row;
	}

	async list({ limit, offset }: Pagination): Promise<{ items: Memo[]; total: number }> {
		const [items, [totals]] = await Promise.all([
			this.db.select().from(memos).orderBy(desc(memos.createdAt)).limit(limit).offset(offset),
			this.db.select({ total: count() }).from(memos),
		]);
		return { items, total: totals?.total ?? 0 };
	}

	/** True when a row was deleted. */
	async remove(id: string): Promise<boolean> {
		const deleted = await this.db.delete(memos).where(eq(memos.id, id)).returning({ id: memos.id });
		return deleted.length > 0;
	}

	async listByTopic(
		topicId: string,
		{ limit, offset }: Pagination,
	): Promise<{ items: Memo[]; total: number }> {
		const [items, [totals]] = await Promise.all([
			this.db
				.select()
				.from(memos)
				.where(eq(memos.topicId, topicId))
				.orderBy(desc(memos.createdAt), desc(memos.id))
				.limit(limit)
				.offset(offset),
			this.db.select({ total: count() }).from(memos).where(eq(memos.topicId, topicId)),
		]);
		return { items, total: totals?.total ?? 0 };
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
