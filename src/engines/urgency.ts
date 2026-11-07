import { DAY_MS } from './sm2.js';

export interface UrgencyInput {
	nextReviewAt: Date;
	interval: number;
	priorityWeight: number;
}

export function urgencyScore(card: UrgencyInput, now: Date): number {
	const daysOverdue = Math.max(0, (now.getTime() - card.nextReviewAt.getTime()) / DAY_MS);
	return (daysOverdue / Math.max(card.interval, 1) + 1) * card.priorityWeight;
}
