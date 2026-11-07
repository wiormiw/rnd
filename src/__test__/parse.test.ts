import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { isAppError } from '../common/errors.js';
import { rowParser } from '../common/parse.js';

describe('rowParser', () => {
	const parseRow = rowParser(z.object({ id: z.number(), name: z.string() }), 'users');

	it('returns the parsed row', () => {
		expect(parseRow({ id: 1, name: 'a' })).toEqual({ id: 1, name: 'a' });
	});

	it('throws an internal AppError carrying the Zod error as cause', () => {
		let caught: unknown;
		try {
			parseRow({ id: 'x', name: 'a' });
		} catch (error) {
			caught = error;
		}
		expect(isAppError(caught)).toBe(true);
		expect(caught).toMatchObject({ code: 'internal', message: 'users row failed validation' });
		expect((caught as Error).cause).toBeInstanceOf(z.ZodError);
	});

	it('is safe to pass straight to Array#map', () => {
		expect([{ id: 1, name: 'a' }].map(parseRow)).toEqual([{ id: 1, name: 'a' }]);
	});
});
