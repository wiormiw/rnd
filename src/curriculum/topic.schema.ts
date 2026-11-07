import * as z from 'zod';
import type { topics } from '../database/schema.js';
import { idSchema } from '../common/schemas.js';

const title = z.string().trim().min(1).max(200);
const description = z.string().max(10_000);

export const topicInsertSchema = z.strictObject({ title, description: description.default('') });

/** Partial update (PATCH): every field optional, but at least one must be present. */
export const topicUpdateSchema = z
	.strictObject({ title: title.optional(), description: description.optional() })
	.refine((patch) => Object.values(patch).some((v) => v !== undefined), {
		message: 'At least one field must be provided',
	});

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
