import * as z from 'zod';
import { memos } from '../database/schema.js';
import {
	createInsertSchema,
	createSelectSchema,
	createUpdateSchema,
	idSchema,
} from '../common/schemas.js';

// Response schema, kept for OpenAPI/response documentation wiring; not yet consumed.
// fallow-ignore-next-line unused-export
export const memoSchema = createSelectSchema(memos, {
	id: idSchema,
});

/** Server-owned columns: never accepted from a client. */
const serverOwned = { id: true, createdAt: true } as const;

export const memoInsertSchema = createInsertSchema(memos, {
	title: z.string().trim().min(1).max(200),
	body: z.string().max(50_000).default(''),
}).omit(serverOwned);

/** Partial update (PATCH): every field optional, but at least one must be present. */
export const memoUpdateSchema = createUpdateSchema(memos, {
	title: (s) => s.trim().min(1).max(200),
	body: (s) => s.max(50_000),
})
	.omit(serverOwned)
	.refine((patch) => Object.values(patch).some((v) => v !== undefined), {
		message: 'At least one field must be provided',
	});

export type Memo = z.infer<typeof memoSchema>;
export type MemoInsert = z.infer<typeof memoInsertSchema>;
export type MemoUpdate = z.infer<typeof memoUpdateSchema>;
