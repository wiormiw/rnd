import * as z from 'zod';
import type { Card } from '../cards/card.schema.js';

const DEFAULT_MAX_MINUTES = 45;

export const dailyQuery = z.object({
	maxMinutes: z.coerce.number().int().min(1).max(480).default(DEFAULT_MAX_MINUTES),
});

export type DueCard = Pick<
	Card,
	| 'id'
	| 'topicId'
	| 'front'
	| 'back'
	| 'estimatedMinutes'
	| 'priorityWeight'
	| 'smInterval'
	| 'nextReviewAt'
>;

export type SprintCard = Pick<DueCard, 'id' | 'topicId' | 'front' | 'back' | 'estimatedMinutes'>;

export interface SprintItem {
	card: SprintCard;
	urgency: number;
}

export interface DailySprint {
	generatedAt: Date;
	maxMinutes: number;
	totalCards: number;
	allocatedMinutes: number;
	items: SprintItem[];
}
