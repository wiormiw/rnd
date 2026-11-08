import * as z from 'zod';
import { ERROR_CODES } from './errors.js';
import { createSchemaFactory } from 'drizzle-orm/zod';

/** Shapes shared by every module. Module-specific schemas live next to the module. */

export const idSchema = z.uuid();

/** A required, trimmed string of at most `max` characters. */
export const text = (max: number) => (s: z.ZodString) => s.trim().min(1).max(max);

export const idParams = z.object({ id: idSchema });
export type IdParams = z.infer<typeof idParams>;

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

export type Page<Item> = z.infer<ReturnType<typeof paginated<z.ZodType<Item>>>>;

export const toPage = <Item>(
	items: Item[],
	total: number,
	{ limit, offset }: Pagination,
): Page<Item> => ({ items, total, limit, offset });

/** Every non-2xx response has this shape. */
export const errorResponse = z.object({
	code: z.enum(ERROR_CODES),
	message: z.string(),
	details: z.unknown().optional(),
});
export type ErrorBody = z.infer<typeof errorResponse>;

export const { createSelectSchema, createInsertSchema, createUpdateSchema } = createSchemaFactory({
	coerce: {
		date: true,
	},
});

/** For PATCH bodies: every field is optional, but an empty patch is rejected. */
export const atLeastOneField = <Schema extends z.ZodType<Record<string, unknown>>>(
	schema: Schema,
) =>
	schema.refine((patch) => Object.values(patch).some((v) => v !== undefined), {
		message: 'At least one field must be provided',
	});
