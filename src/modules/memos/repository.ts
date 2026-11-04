import { count, desc, eq } from 'drizzle-orm';
import type { Database } from '../../infrastructure/db/client.js';
import { memos } from '../../infrastructure/db/schema.js';
import type { Pagination } from '../../lib/schemas.js';
import type { CreateMemoInput, Memo } from './schema.js';

/**
 * Persistence only: no business rules, no HTTP, no Results. "Not found" is an
 * ordinary answer here (`undefined` / `false`); the service decides what it
 * means. Infrastructure failures are thrown.
 */
export interface MemoRepository {
	insert(input: CreateMemoInput): Promise<Memo>;
	findById(id: string): Promise<Memo | undefined>;
	list(page: Pagination): Promise<{ items: Memo[]; total: number }>;
	/** True when a row was deleted. */
	remove(id: string): Promise<boolean>;
}

export function createMemoRepository(db: Database): MemoRepository {
	return {
		async insert(input) {
			const [row] = await db.insert(memos).values(input).returning();
			if (!row) throw new Error('insert into memos returned no row');
			return row;
		},

		async findById(id) {
			const [row] = await db.select().from(memos).where(eq(memos.id, id)).limit(1);
			return row;
		},

		async list({ limit, offset }) {
			const [items, [totals]] = await Promise.all([
				db.select().from(memos).orderBy(desc(memos.createdAt)).limit(limit).offset(offset),
				db.select({ total: count() }).from(memos),
			]);
			return { items, total: totals?.total ?? 0 };
		},

		async remove(id) {
			const deleted = await db.delete(memos).where(eq(memos.id, id)).returning({ id: memos.id });
			return deleted.length > 0;
		},
	};
}
