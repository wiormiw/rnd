import * as z from 'zod';
import { topics } from '../database/schema.js';
import {
	atLeastOneField,
	createInsertSchema,
	createUpdateSchema,
	idSchema,
} from '../common/schemas.js';

/** Server-owned columns: never accepted from a client. */
const serverOwned = { id: true, createdAt: true, updatedAt: true } as const;

export const topicInsertSchema = createInsertSchema(topics, {
	title: (s) => s.trim().min(1).max(200),
	description: (s) => s.max(10_000).default(''),
})
	.omit(serverOwned)
	.strict();

/** Partial update (PATCH): every field optional, but at least one must be present. */
export const topicUpdateSchema = atLeastOneField(
	createUpdateSchema(topics, {
		title: (s) => s.trim().min(1).max(200),
		description: (s) => s.max(10_000),
	})
		.omit(serverOwned)
		.strict(),
);

export const prerequisiteParams = z.object({ id: idSchema, prerequisiteId: idSchema });

export type TopicRow = typeof topics.$inferSelect;
export type TopicInsert = z.infer<typeof topicInsertSchema>;
export type TopicUpdate = z.infer<typeof topicUpdateSchema>;

/** A topic plus what the curriculum graph says about it. */
export interface Topic extends TopicRow {
	prerequisiteIds: string[];
	cardCount: number;
	mastered: boolean;
	unlocked: boolean;
}
