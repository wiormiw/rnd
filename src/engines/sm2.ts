export interface Sm2State {
	interval: number;
	repetition: number;
	easeFactor: number;
}

export interface Sm2Result extends Sm2State {
	nextReviewAt: Date;
}

export const DAY_MS = 86_400_000;

const MIN_EASE_FACTOR = 1.3;

export function calculateSM2(state: Sm2State, qualityScore: number, now: Date): Sm2Result {
	if (!Number.isInteger(qualityScore) || qualityScore < 0 || qualityScore > 5) {
		throw new RangeError(`qualityScore must be an integer between 0 and 5, got ${qualityScore}`);
	}

	const penalty = 5 - qualityScore;
	const easeFactor = Math.max(
		MIN_EASE_FACTOR,
		state.easeFactor + (0.1 - penalty * (0.08 + penalty * 0.02)),
	);

	let interval: number;
	let repetition: number;

	if (qualityScore >= 3) {
		if (state.repetition === 0) {
			interval = 1;
		} else if (state.repetition === 1) {
			interval = 6;
		} else {
			interval = Math.round(state.interval * easeFactor);
		}
		repetition = state.repetition + 1;
	} else {
		repetition = 0;
		interval = 1;
	}

	return {
		interval,
		repetition,
		easeFactor,
		nextReviewAt: new Date(now.getTime() + interval * DAY_MS),
	};
}
