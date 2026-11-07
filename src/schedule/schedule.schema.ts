import * as z from 'zod';

const DEFAULT_MAX_MINUTES = 45;

export const dailyQuery = z.object({
	maxMinutes: z.coerce.number().int().min(1).max(480).default(DEFAULT_MAX_MINUTES),
});

export interface DueCard {
	id: string;
	topicId: string;
	front: string;
	back: string;
	estimatedMinutes: number;
	priorityWeight: number;
	smInterval: number;
	nextReviewAt: Date;
}

export interface SprintItem {
	card: Pick<DueCard, 'id' | 'topicId' | 'front' | 'back' | 'estimatedMinutes'>;
	urgency: number;
}

export interface DailySprint {
	generatedAt: Date;
	maxMinutes: number;
	totalCards: number;
	allocatedMinutes: number;
	items: SprintItem[];
}
