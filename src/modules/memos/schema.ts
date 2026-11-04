import * as z from 'zod';
import { idSchema } from '../../lib/schemas.js';

export const memoSchema = z.object({
	id: idSchema,
	title: z.string(),
	body: z.string(),
	createdAt: z.date(),
});

export const createMemoBody = z.object({
	title: z.string().trim().min(1).max(200),
	body: z.string().max(50_000).default(''),
});

export type Memo = z.infer<typeof memoSchema>;
export type CreateMemoInput = z.infer<typeof createMemoBody>;
