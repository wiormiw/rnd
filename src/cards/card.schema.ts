import type * as z from 'zod';
import { cards } from '../database/schema.js';
import { createInsertSchema, createUpdateSchema, idSchema } from '../common/schemas.js';

/**
 * Scheduling state (sm*, nextReviewAt) and topicId (from the URL) are
 * server-owned. Schemas are strict, so a client sending them gets a 400.
 */
const serverOwned = {
	id: true,
	topicId: true,
	smInterval: true,
	smRepetition: true,
	smEaseFactor: true,
	nextReviewAt: true,
	createdAt: true,
	updatedAt: true,
} as const;

export const cardInsertSchema = createInsertSchema(cards, {
	front: (s) => s.trim().min(1).max(2000),
	back: (s) => s.trim().min(1).max(10_000),
	memoId: idSchema.nullable().optional(),
	estimatedMinutes: (s) => s.min(1).max(120).default(2),
	priorityWeight: (s) => s.min(0.001).max(10).default(1),
})
	.omit(serverOwned)
	.strict();

/** Partial update (PATCH): every field optional, but at least one must be present. */
export const cardUpdateSchema = createUpdateSchema(cards, {
	front: (s) => s.trim().min(1).max(2000),
	back: (s) => s.trim().min(1).max(10_000),
	memoId: idSchema.nullable().optional(),
	estimatedMinutes: (s) => s.min(1).max(120),
	priorityWeight: (s) => s.min(0.001).max(10),
})
	.omit(serverOwned)
	.strict()
	.refine((patch) => Object.values(patch).some((v) => v !== undefined), {
		message: 'At least one field must be provided',
	});

export type Card = typeof cards.$inferSelect;
export type CardInsert = z.infer<typeof cardInsertSchema>;
export type CardUpdate = z.infer<typeof cardUpdateSchema>;
