export const MASTERY_REPETITIONS = 2;

export interface MasteryCard {
	id: string;
	repetition: number;
}

export function isMastered(
	cards: readonly MasteryCard[],
	pendingCardIds: ReadonlySet<string>,
): boolean {
	return cards.every(
		(card) => card.repetition >= MASTERY_REPETITIONS && !pendingCardIds.has(card.id),
	);
}
