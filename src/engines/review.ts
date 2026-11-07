import { calculateSM2, type Sm2Result } from './sm2.js';

/** A quality score below this spawns a remediation (practice) action item. */
export const REMEDIATION_THRESHOLD = 2;

const TITLE_PREFIX = 'Practice: ';
const TITLE_FRONT_MAX = 180;

export interface ReviewedCard {
	front: string;
	smInterval: number;
	smRepetition: number;
	smEaseFactor: number;
}

export interface ReviewInput {
	qualityScore: number;
	timeSpentSeconds: number;
}

export interface ReviewLogEntry {
	qualityScore: number;
	timeSpentSeconds: number;
	previousInterval: number;
	newInterval: number;
	previousEaseFactor: number;
	newEaseFactor: number;
	reviewedAt: Date;
}

export interface ReviewDecision {
	sm2: Sm2Result;
	log: ReviewLogEntry;
	/** Non-null spawns a remediation action item. */
	actionItemTitle: string | null;
}

export function needsRemediation(qualityScore: number): boolean {
	return qualityScore < REMEDIATION_THRESHOLD;
}

/** Next SM-2 state, the log row, and the practice task title when remediation is needed. */
export function decideReview(card: ReviewedCard, input: ReviewInput, now: Date): ReviewDecision {
	const sm2 = calculateSM2(
		{ interval: card.smInterval, repetition: card.smRepetition, easeFactor: card.smEaseFactor },
		input.qualityScore,
		now,
	);
	return {
		sm2,
		log: {
			qualityScore: input.qualityScore,
			timeSpentSeconds: input.timeSpentSeconds,
			previousInterval: card.smInterval,
			newInterval: sm2.interval,
			previousEaseFactor: card.smEaseFactor,
			newEaseFactor: sm2.easeFactor,
			reviewedAt: now,
		},
		actionItemTitle: needsRemediation(input.qualityScore)
			? `${TITLE_PREFIX}${card.front.slice(0, TITLE_FRONT_MAX)}`
			: null,
	};
}
