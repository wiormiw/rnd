import { describe, expect, it } from 'vitest';
import { DAY_MS, calculateSM2 } from '../engines/sm2.js';

const DEFAULT_STATE = { interval: 0, repetition: 0, easeFactor: 2.5 };
const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('SM-2', () => {
	it('handles each quality score from the default state', () => {
		const q0 = calculateSM2(DEFAULT_STATE, 0, NOW);
		expect(q0).toMatchObject({ interval: 1, repetition: 0 });
		expect(q0.easeFactor).toBeCloseTo(1.7, 10);

		const q1 = calculateSM2(DEFAULT_STATE, 1, NOW);
		expect(q1).toMatchObject({ interval: 1, repetition: 0 });

		const q2 = calculateSM2(DEFAULT_STATE, 2, NOW);
		expect(q2).toMatchObject({ interval: 1, repetition: 0 });

		const q3 = calculateSM2(DEFAULT_STATE, 3, NOW);
		expect(q3.interval).toBe(1);
		expect(q3.repetition).toBe(1);
		expect(q3.easeFactor).toBeCloseTo(2.36, 10);

		const q4 = calculateSM2(DEFAULT_STATE, 4, NOW);
		expect(q4).toMatchObject({ interval: 1, repetition: 1 });
		expect(q4.easeFactor).toBeCloseTo(2.5, 10);

		const q5 = calculateSM2(DEFAULT_STATE, 5, NOW);
		expect(q5).toMatchObject({ interval: 1, repetition: 1 });
		expect(q5.easeFactor).toBeCloseTo(2.6, 10);
	});
});

describe('SM-2 progression', () => {
	it('floors the ease factor at 1.3 after repeated q=0', () => {
		let state = DEFAULT_STATE;
		for (let i = 0; i < 5; i++) {
			state = calculateSM2(state, 0, NOW);
		}
		expect(state.easeFactor).toBe(1.3);
		expect(calculateSM2(state, 0, NOW).easeFactor).toBe(1.3);
	});

	it('progresses interval 1 -> 6 -> round(6 * EF) with q=5', () => {
		const first = calculateSM2(DEFAULT_STATE, 5, NOW);
		expect(first.interval).toBe(1);

		const second = calculateSM2(first, 5, NOW);
		expect(second.interval).toBe(6);

		const third = calculateSM2(second, 5, NOW);
		// EF after the third review is 2.8, so round(6 * 2.8) = 17.
		expect(third.easeFactor).toBeCloseTo(2.8, 10);
		expect(third.interval).toBe(Math.round(6 * third.easeFactor));
		expect(third.interval).toBe(17);
		expect(third.repetition).toBe(3);
	});

	it('sets nextReviewAt to now plus interval days', () => {
		const result = calculateSM2({ interval: 6, repetition: 2, easeFactor: 2.5 }, 4, NOW);
		expect(result.interval).toBe(15);
		expect(result.nextReviewAt.getTime()).toBe(NOW.getTime() + 15 * DAY_MS);
	});

	it('resets repetition and interval on a failed review', () => {
		const result = calculateSM2({ interval: 30, repetition: 5, easeFactor: 2.5 }, 2, NOW);
		expect(result).toMatchObject({ interval: 1, repetition: 0 });
	});

	it.each([6, -1, 2.5, Number.NaN])('throws RangeError for invalid quality %s', (q) => {
		expect(() => calculateSM2(DEFAULT_STATE, q, NOW)).toThrow(RangeError);
	});
});
