import * as z from 'zod';
import type { cards } from '../database/schema.js';
import { idSchema } from '../common/schemas.js';

const fields = {
	front: z.string().trim().min(1).max(2000),
	back: z.string().trim().min(1).max(10_000),
	memoId: idSchema.nullable(),
	estimatedMinutes: z.number().int().min(1).max(120),
	priorityWeight: z.number().gt(0).max(10),
};

/**
 * Strict: scheduling state (sm*, nextReviewAt) and topicId are server-owned, so
 * a client sending them gets a 400 rather than a silent ignore.
 */
export const cardInsertSchema = z.strictObject({
	front: fields.front,
	back: fields.back,
	memoId: fields.memoId.optional(),
	estimatedMinutes: fields.estimatedMinutes.default(2),
	priorityWeight: fields.priorityWeight.default(1),
});

export const cardUpdateSchema = z
	.strictObject({
		front: fields.front.optional(),
		back: fields.back.optional(),
		memoId: fields.memoId.optional(),
		estimatedMinutes: fields.estimatedMinutes.optional(),
		priorityWeight: fields.priorityWeight.optional(),
	})
	.refine((patch) => Object.values(patch).some((v) => v !== undefined), {
		message: 'At least one field must be provided',
	});

export type Card = typeof cards.$inferSelect;
export type CardInsert = z.infer<typeof cardInsertSchema>;
export type CardUpdate = z.infer<typeof cardUpdateSchema>;
