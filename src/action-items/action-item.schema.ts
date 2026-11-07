import type * as z from 'zod';
import { actionItemStatus, type actionItems } from '../database/schema.js';
import { createSelectSchema, paginationQuery } from '../common/schemas.js';

export type ActionItem = typeof actionItems.$inferSelect;

export const actionItemListQuery = paginationQuery.extend({
	status: createSelectSchema(actionItemStatus).optional(),
});

export type ActionItemListQuery = z.infer<typeof actionItemListQuery>;
