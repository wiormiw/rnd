import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../engines/sm2.js';
import { urgencyScore } from '../engines/urgency.js';

const NOW = new Date('2026-01-10T00:00:00.000Z');

describe('urgencyScore', () => {
	it('returns priorityWeight when not overdue', () => {
		const future = new Date(NOW.getTime() + 2 * DAY_MS);
		expect(urgencyScore({ nextReviewAt: future, interval: 3, priorityWeight: 2.5 }, NOW)).toBe(2.5);
		expect(urgencyScore({ nextReviewAt: NOW, interval: 3, priorityWeight: 2.5 }, NOW)).toBe(2.5);
	});

	it('scales by overdue days over interval', () => {
		const due = new Date(NOW.getTime() - 3 * DAY_MS);
		expect(urgencyScore({ nextReviewAt: due, interval: 1, priorityWeight: 2 }, NOW)).toBe(4 * 2);
	});

	it('treats interval 0 as 1', () => {
		const due = new Date(NOW.getTime() - 3 * DAY_MS);
		expect(urgencyScore({ nextReviewAt: due, interval: 0, priorityWeight: 2 }, NOW)).toBe(
			urgencyScore({ nextReviewAt: due, interval: 1, priorityWeight: 2 }, NOW),
		);
	});
});
