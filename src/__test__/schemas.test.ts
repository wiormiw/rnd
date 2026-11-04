import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { errorResponse, idParams, paginated, paginationQuery } from '../lib/schemas.js';

describe('paginationQuery', () => {
	it('defaults and coerces query strings', () => {
		expect(paginationQuery.parse({})).toEqual({ limit: 20, offset: 0 });
		expect(paginationQuery.parse({ limit: '5', offset: '10' })).toEqual({ limit: 5, offset: 10 });
	});

	it.each([{ limit: '0' }, { limit: '101' }, { offset: '-1' }, { limit: '1.5' }, { limit: 'x' }])(
		'rejects %o',
		(query) => {
			expect(paginationQuery.safeParse(query).success).toBe(false);
		},
	);
});

describe('paginated', () => {
	const schema = paginated(z.object({ id: z.number() }));

	it('wraps any item schema in the standard envelope', () => {
		const page = { items: [{ id: 1 }], total: 1, limit: 20, offset: 0 };
		expect(schema.parse(page)).toEqual(page);
	});

	it('rejects items of the wrong shape', () => {
		expect(schema.safeParse({ items: [{ id: 'x' }], total: 1, limit: 1, offset: 0 }).success).toBe(
			false,
		);
	});
});

describe('idParams / errorResponse', () => {
	it('requires a uuid', () => {
		expect(idParams.safeParse({ id: 'nope' }).success).toBe(false);
		expect(idParams.safeParse({ id: '0b8c3a4e-6f5d-4c1e-9a77-3c2f1d9e8b10' }).success).toBe(true);
	});

	it('only allows known error codes', () => {
		expect(errorResponse.safeParse({ code: 'not_found', message: 'x' }).success).toBe(true);
		expect(errorResponse.safeParse({ code: 'teapot', message: 'x' }).success).toBe(false);
	});
});
