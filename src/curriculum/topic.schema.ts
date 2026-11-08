import * as z from 'zod';
import { topics } from '../database/schema.js';
import {
	atLeastOneField,
	createInsertSchema,
	createUpdateSchema,
	idSchema,
	text,
} from '../common/schemas.js';

/** Server-owned columns: never accepted from a client. */
const serverOwned = { id: true, createdAt: true, updatedAt: true } as const;

const description = (s: z.ZodString) => s.max(10_000);

export const topicInsertSchema = createInsertSchema(topics, {
	title: text(200),
	description: (s) => description(s).default(''),
})
	.omit(serverOwned)
	.strict();

/** Partial update (PATCH): every field optional, but at least one must be present. */
export const topicUpdateSchema = atLeastOneField(
	createUpdateSchema(topics, {
		title: text(200),
		description,
	})
		.omit(serverOwned)
		.strict(),
);

export const prerequisiteParams = z.object({ id: idSchema, prerequisiteId: idSchema });

export type PrerequisiteParams = z.infer<typeof prerequisiteParams>;
export type TopicRow = typeof topics.$inferSelect;
export type TopicInsert = z.infer<typeof topicInsertSchema>;
export type TopicUpdate = z.infer<typeof topicUpdateSchema>;

/** What the curriculum graph says about a topic. */
export interface TopicStatus {
	prerequisiteIds: string[];
	cardCount: number;
	mastered: boolean;
	unlocked: boolean;
}

/** A topic plus its graph status. */
export type Topic = TopicRow & TopicStatus;
