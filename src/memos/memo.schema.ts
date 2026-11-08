import * as z from 'zod';
import { memos } from '../database/schema.js';
import {
	atLeastOneField,
	createInsertSchema,
	createSelectSchema,
	createUpdateSchema,
	idSchema,
	text,
} from '../common/schemas.js';

// Response schema, kept for OpenAPI/response documentation wiring; not yet consumed.
export const memoSchema = createSelectSchema(memos, {
	id: idSchema,
});

/** Server-owned columns: never accepted from a client. */
const body = (s: z.ZodString) => s.max(50_000);

const serverOwned = { id: true, createdAt: true } as const;

export const memoInsertSchema = createInsertSchema(memos, {
	title: text(200),
	body: (s) => body(s).default(''),
	topicId: idSchema.nullable().optional(),
}).omit(serverOwned);

/** Partial update (PATCH): every field optional, but at least one must be present. */
export const memoUpdateSchema = atLeastOneField(
	createUpdateSchema(memos, {
		title: text(200),
		body,
		topicId: idSchema.nullable().optional(),
	}).omit(serverOwned),
);

export type Memo = z.infer<typeof memoSchema>;
export type MemoInsert = z.infer<typeof memoInsertSchema>;
export type MemoUpdate = z.infer<typeof memoUpdateSchema>;
