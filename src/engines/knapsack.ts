export interface SprintCandidate {
	id: string;
	estimatedMinutes: number;
	urgency: number;
}

export const MAX_CANDIDATES = 2000;

function compareCandidates(a: SprintCandidate, b: SprintCandidate): number {
	if (a.urgency !== b.urgency) {
		return b.urgency - a.urgency;
	}
	if (a.id < b.id) {
		return -1;
	}
	return a.id > b.id ? 1 : 0;
}

/**
 * 0/1 knapsack maximising total urgency, weight = estimatedMinutes, capacity = maxMinutes.
 * Returns the selected items in the pre-sorted (urgency desc, id asc) order.
 */
export function scheduleSprint<T extends SprintCandidate>(
	candidates: readonly T[],
	maxMinutes: number,
): T[] {
	if (maxMinutes <= 0 || candidates.length === 0) {
		return [];
	}

	const items = [...candidates].sort(compareCandidates).slice(0, MAX_CANDIDATES);
	const n = items.length;
	const capacity = Math.floor(maxMinutes);
	const width = capacity + 1;

	const values = new Float64Array(width);
	const keep = new Uint8Array(n * width);

	for (let i = 0; i < n; i++) {
		const item = items[i]!;
		const weight = item.estimatedMinutes;
		if (weight > capacity) {
			continue;
		}
		for (let w = capacity; w >= weight; w--) {
			const withItem = values[w - weight]! + item.urgency;
			if (withItem > values[w]!) {
				values[w] = withItem;
				keep[i * width + w] = 1;
			}
		}
	}

	const selected: T[] = [];
	let w = capacity;
	for (let i = n - 1; i >= 0; i--) {
		if (keep[i * width + w] === 1) {
			const item = items[i]!;
			selected.push(item);
			w -= item.estimatedMinutes;
		}
	}

	return selected.reverse();
}
