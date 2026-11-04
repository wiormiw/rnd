import { describe, expect, it } from 'vitest';
import { errors } from '../lib/errors.js';
import { andThen, andThenAsync, err, fromNullable, map, ok, unwrap } from '../lib/result.js';

describe('Result', () => {
	it('map transforms only successes', () => {
		expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
		const failure = err(errors.notFound('x'));
		expect(map(failure, (n: number) => n * 2)).toBe(failure);
	});

	it('andThen chains and short-circuits on the first error', () => {
		const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err(errors.invalid('odd')));

		expect(andThen(ok(8), half)).toEqual(ok(4));
		expect(andThen(andThen(ok(6), half), half)).toMatchObject({ ok: false });
		expect(andThen(err(errors.invalid('first')), half)).toMatchObject({
			ok: false,
			error: { message: 'first' },
		});
	});

	it('andThenAsync chains async steps', async () => {
		const result = await andThenAsync(ok(1), async (n) => ok(n + 1));
		expect(result).toEqual(ok(2));
	});

	it('fromNullable turns null and undefined into the given error', () => {
		expect(fromNullable(0, () => errors.notFound('n'))).toEqual(ok(0));
		expect(fromNullable(undefined, () => errors.notFound('n'))).toMatchObject({ ok: false });
		expect(fromNullable(null, () => errors.notFound('n'))).toMatchObject({ ok: false });
	});

	it('unwrap returns the value or throws the error itself', () => {
		expect(unwrap(ok('v'))).toBe('v');
		const error = errors.conflict('dup');
		expect(() => unwrap(err(error))).toThrow(error);
	});
});
