import type * as z from 'zod';
import { cards } from '../database/schema.js';
import {
	atLeastOneField,
	createInsertSchema,
	createUpdateSchema,
	idSchema,
	text,
} from '../common/schemas.js';

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

const minutes = (s: z.ZodInt) => s.min(1).max(120);
const weight = (s: z.ZodNumber) => s.min(0.001).max(10);
const memoId = idSchema.nullable().optional();

export const cardInsertSchema = createInsertSchema(cards, {
	front: text(2000),
	back: text(10_000),
	memoId,
	estimatedMinutes: (s) => minutes(s).default(2),
	priorityWeight: (s) => weight(s).default(1),
})
	.omit(serverOwned)
	.strict();

/** Partial update (PATCH): every field optional, but at least one must be present. */
export const cardUpdateSchema = atLeastOneField(
	createUpdateSchema(cards, {
		front: text(2000),
		back: text(10_000),
		memoId,
		estimatedMinutes: minutes,
		priorityWeight: weight,
	})
		.omit(serverOwned)
		.strict(),
);

export type Card = typeof cards.$inferSelect;
export type CardInsert = z.infer<typeof cardInsertSchema>;
export type CardUpdate = z.infer<typeof cardUpdateSchema>;
