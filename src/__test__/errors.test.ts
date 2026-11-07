import { describe, expect, it } from 'vitest';
import { AppError, errors, isAppError } from '../common/errors.js';

describe('errors factory', () => {
	it('builds AppErrors with a code and safe details', () => {
		const error = errors.notFound('memo', 'abc');
		expect(error).toBeInstanceOf(AppError);
		expect(isAppError(error)).toBe(true);
		expect(error).toMatchObject({
			code: 'not_found',
			message: 'memo not found',
			details: { resource: 'memo', id: 'abc' },
		});
	});

	it('covers each business case without any HTTP vocabulary', () => {
		expect(errors.invalid('bad', [1]).code).toBe('invalid');
		expect(errors.unauthorized().code).toBe('unauthorized');
		expect(errors.forbidden().code).toBe('forbidden');
		expect(errors.conflict('dup').code).toBe('conflict');
		expect(errors.rateLimited(1500)).toMatchObject({
			code: 'rate_limited',
			details: { retryAfterSeconds: 2 },
		});
		expect(errors.rateLimited(0).details).toEqual({ retryAfterSeconds: 1 });
		expect(errors.unavailable('payments').code).toBe('unavailable');
		expect(errors.internal('oops').code).toBe('internal');
		for (const error of Object.values(errors).map((make) =>
			(make as (x: never) => unknown)('x' as never),
		)) {
			expect(error).not.toHaveProperty('statusCode');
		}
	});

	it('keeps the cause out of the message', () => {
		const cause = new Error('secret connection string');
		const error = errors.unavailable('db', cause);
		expect(error.cause).toBe(cause);
		expect(error.message).toBe('db is unavailable');
	});

	it('does not treat plain errors as AppErrors', () => {
		expect(isAppError(new Error('x'))).toBe(false);
		expect(isAppError({ code: 'not_found' })).toBe(false);
	});
});
