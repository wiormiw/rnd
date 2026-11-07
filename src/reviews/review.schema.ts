import type * as z from 'zod';
import { reviewLogs } from '../database/schema.js';
import { createInsertSchema } from '../common/schemas.js';

export const reviewInsertSchema = createInsertSchema(reviewLogs, {
	qualityScore: (s) => s.min(0).max(5),
	timeSpentSeconds: (s) => s.min(0).max(86_400),
})
	.pick({ qualityScore: true, timeSpentSeconds: true })
	.strict();

export type ReviewInsert = z.infer<typeof reviewInsertSchema>;
export type ReviewLog = typeof reviewLogs.$inferSelect;
