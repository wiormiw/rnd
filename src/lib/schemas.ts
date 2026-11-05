import * as z from 'zod';
import { ERROR_CODES } from './errors.js';
import { createSchemaFactory } from 'drizzle-orm/zod';

/** Shapes shared by every module. Module-specific schemas live next to the module. */

export const idSchema = z.uuid();

export const idParams = z.object({ id: idSchema });

export const paginationQuery = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationQuery>;

/** Response envelope for any paginated list. */
export const paginated = <Item extends z.ZodType>(item: Item) =>
	z.object({
		items: z.array(item),
		total: z.number().int().min(0),
		limit: z.number().int(),
		offset: z.number().int(),
	});

export interface Page<Item> {
	items: Item[];
	total: number;
	limit: number;
	offset: number;
}

/** Every non-2xx response has this shape. */
export const errorResponse = z.object({
	code: z.enum(ERROR_CODES),
	message: z.string(),
	details: z.unknown().optional(),
});

/** Spread into a route's `response` schema to document the standard errors. */
export const errorResponses = {
	400: errorResponse,
	404: errorResponse,
	429: errorResponse,
	500: errorResponse,
} as const;

export const { createSelectSchema, createInsertSchema, createUpdateSchema } = createSchemaFactory({
	coerce: {
		date: true,
	},
});
