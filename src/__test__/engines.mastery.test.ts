import { describe, expect, it } from 'vitest';
import { MASTERY_REPETITIONS, isMastered } from '../engines/mastery.js';

describe('isMastered', () => {
	it('is true for an empty card list', () => {
		expect(isMastered([], new Set())).toBe(true);
	});

	it('is false when a card is below the repetition threshold', () => {
		expect(isMastered([{ id: 'a', repetition: MASTERY_REPETITIONS - 1 }], new Set())).toBe(false);
	});

	it('is true when every card meets the threshold and none are pending', () => {
		expect(
			isMastered(
				[
					{ id: 'a', repetition: MASTERY_REPETITIONS },
					{ id: 'b', repetition: 5 },
				],
				new Set(),
			),
		).toBe(true);
	});

	it('is false when a card is pending, even with enough repetitions', () => {
		expect(isMastered([{ id: 'a', repetition: 3 }], new Set(['a']))).toBe(false);
	});
});
