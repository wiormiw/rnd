import * as z from 'zod';
import type { actionItems } from '../database/schema.js';
import { paginationQuery } from '../common/schemas.js';

export type ActionItem = typeof actionItems.$inferSelect;

export const actionItemListQuery = paginationQuery.extend({
	status: z.enum(['PENDING', 'DONE']).optional(),
});

export type ActionItemListQuery = z.infer<typeof actionItemListQuery>;
