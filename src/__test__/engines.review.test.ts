import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../engines/sm2.js';
import { REMEDIATION_THRESHOLD, decideReview, needsRemediation } from '../engines/review.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const CARD = { front: 'What is O(n log n)?', smInterval: 6, smRepetition: 2, smEaseFactor: 2.5 };

describe('needsRemediation', () => {
	it('is true only below the threshold', () => {
		expect(REMEDIATION_THRESHOLD).toBe(2);
		expect([0, 1, 2, 3, 4, 5].map(needsRemediation)).toEqual([
			true,
			true,
			false,
			false,
			false,
			false,
		]);
	});
});

describe('decideReview', () => {
	it('records previous and new SM-2 values in the log', () => {
		const decision = decideReview(CARD, { qualityScore: 5, timeSpentSeconds: 12 }, NOW);
		expect(decision.sm2.interval).toBe(Math.round(6 * decision.sm2.easeFactor));
		expect(decision.sm2.nextReviewAt.getTime()).toBe(
			NOW.getTime() + decision.sm2.interval * DAY_MS,
		);
		expect(decision.log).toEqual({
			qualityScore: 5,
			timeSpentSeconds: 12,
			previousInterval: 6,
			newInterval: decision.sm2.interval,
			previousEaseFactor: 2.5,
			newEaseFactor: decision.sm2.easeFactor,
			reviewedAt: NOW,
		});
		expect(decision.actionItemTitle).toBeNull();
	});

	it('names a practice task after the card front when the score is low', () => {
		const decision = decideReview(CARD, { qualityScore: 1, timeSpentSeconds: 30 }, NOW);
		expect(decision.actionItemTitle).toBe('Practice: What is O(n log n)?');
		expect(decision.sm2).toMatchObject({ interval: 1, repetition: 0 });
	});

	it('resets SM-2 on a score of 2 without spawning a practice task', () => {
		const decision = decideReview(CARD, { qualityScore: 2, timeSpentSeconds: 30 }, NOW);
		expect(decision.sm2).toMatchObject({ interval: 1, repetition: 0 });
		expect(decision.actionItemTitle).toBeNull();
	});

	it('truncates long fronts in the practice task title', () => {
		const decision = decideReview(
			{ ...CARD, front: 'x'.repeat(500) },
			{ qualityScore: 0, timeSpentSeconds: 0 },
			NOW,
		);
		expect(decision.actionItemTitle).toBe(`Practice: ${'x'.repeat(180)}`);
	});
});
