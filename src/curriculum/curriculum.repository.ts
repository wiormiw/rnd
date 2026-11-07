import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../database/client.js';
import { DATABASE_TOKEN } from '../database/database.service.js';
import { actionItems, cards, topicPrerequisites, topics } from '../database/schema.js';
import type { Edge } from '../engines/index.js';
import type { TopicInsert, TopicRow, TopicUpdate } from './topic.schema.js';

/** Serialises every edge insert so two concurrent requests can't close a cycle together. */
const PREREQUISITE_LOCK = 7_204_311;

export interface MasteryInputs {
	cards: { id: string; topicId: string; repetition: number }[];
	pendingCardIds: string[];
}

export type AddPrerequisiteOutcome = { cycle: string[] } | { added: boolean };

/** Persistence only: "not found" is `undefined` / `false`. */
@Injectable()
export class CurriculumRepository {
	constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}

	async insertTopic(input: TopicInsert, now: Date): Promise<TopicRow> {
		const [row] = await this.db
			.insert(topics)
			.values({ ...input, createdAt: now, updatedAt: now })
			.returning();
		if (!row) throw new Error('insert into topics returned no row');
		return row;
	}

	async findTopic(id: string): Promise<TopicRow | undefined> {
		const [row] = await this.db.select().from(topics).where(eq(topics.id, id)).limit(1);
		return row;
	}

	async updateTopic(id: string, patch: TopicUpdate, now: Date): Promise<TopicRow | undefined> {
		const [row] = await this.db
			.update(topics)
			.set({ ...patch, updatedAt: now })
			.where(eq(topics.id, id))
			.returning();
		return row;
	}

	async removeTopic(id: string): Promise<boolean> {
		const deleted = await this.db
			.delete(topics)
			.where(eq(topics.id, id))
			.returning({ id: topics.id });
		return deleted.length > 0;
	}

	async listTopics(): Promise<TopicRow[]> {
		return this.db.select().from(topics).orderBy(asc(topics.createdAt), asc(topics.id));
	}

	async listEdges(): Promise<Edge[]> {
		return this.db
			.select({
				topicId: topicPrerequisites.topicId,
				prerequisiteId: topicPrerequisites.prerequisiteId,
			})
			.from(topicPrerequisites);
	}

	/**
	 * Cycle check and insert under one advisory lock, in one transaction, so the
	 * graph the check saw is the graph the insert lands in.
	 */
	async addPrerequisite(
		topicId: string,
		prerequisiteId: string,
		check: (edges: Edge[]) => string[] | null,
	): Promise<AddPrerequisiteOutcome> {
		return this.db.transaction(async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(${PREREQUISITE_LOCK})`);
			const edges: Edge[] = await tx
				.select({
					topicId: topicPrerequisites.topicId,
					prerequisiteId: topicPrerequisites.prerequisiteId,
				})
				.from(topicPrerequisites);
			const cycle = check(edges);
			if (cycle) return { cycle };
			const inserted = await tx
				.insert(topicPrerequisites)
				.values({ topicId, prerequisiteId })
				.onConflictDoNothing()
				.returning({ topicId: topicPrerequisites.topicId });
			return { added: inserted.length > 0 };
		});
	}

	async removePrerequisite(topicId: string, prerequisiteId: string): Promise<boolean> {
		const deleted = await this.db
			.delete(topicPrerequisites)
			.where(
				and(
					eq(topicPrerequisites.topicId, topicId),
					eq(topicPrerequisites.prerequisiteId, prerequisiteId),
				),
			)
			.returning({ topicId: topicPrerequisites.topicId });
		return deleted.length > 0;
	}

	async masteryInputs(): Promise<MasteryInputs> {
		const [cardRows, pending] = await Promise.all([
			this.db
				.select({ id: cards.id, topicId: cards.topicId, repetition: cards.smRepetition })
				.from(cards),
			this.db
				.select({ cardId: actionItems.cardId })
				.from(actionItems)
				.where(eq(actionItems.status, 'PENDING')),
		]);
		return { cards: cardRows, pendingCardIds: pending.map((row) => row.cardId) };
	}
}
