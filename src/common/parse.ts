// fallow-ignore-file unused-file
import type * as z from 'zod';
import { errors } from './errors.js';

/**
 * For raw SQL only: ORM queries are already typed from the table definition, so
 * parsing their rows adds nothing. Builds a parser for data that comes from our own storage, not from a client.
 * A mismatch there is a bug or schema drift, so it throws (a generic 500 at the
 * edge) instead of handing bad data to the service. The Zod error is kept as the
 * `cause` for logs and never shown to callers.
 *
 * Returns a one-argument function, so it is safe to pass to `Array#map`.
 */
export function rowParser<S extends z.ZodType>(schema: S, label: string) {
	return (row: unknown): z.output<S> => {
		const parsed = schema.safeParse(row);
		if (!parsed.success) throw errors.internal(`${label} row failed validation`, parsed.error);
		return parsed.data;
	};
}
