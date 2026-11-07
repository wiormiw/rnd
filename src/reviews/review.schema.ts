import * as z from 'zod';
import type { reviewLogs } from '../database/schema.js';

export const reviewInsertSchema = z.strictObject({
	qualityScore: z.int().min(0).max(5),
	timeSpentSeconds: z.int().min(0).max(86_400),
});

export type ReviewInsert = z.infer<typeof reviewInsertSchema>;
export type ReviewLog = typeof reviewLogs.$inferSelect;
