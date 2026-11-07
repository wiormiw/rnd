import { describe, expect, it } from 'vitest';
import { MAX_CANDIDATES, scheduleSprint } from '../engines/knapsack.js';
import type { SprintCandidate } from '../engines/knapsack.js';

/** mulberry32: small seeded PRNG so random cases are reproducible. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomCandidates(rand: () => number, n: number): SprintCandidate[] {
	return Array.from({ length: n }, (_, i) => ({
		id: `c${i}`,
		estimatedMinutes: 1 + Math.floor(rand() * 15),
		urgency: Math.round(rand() * 1000) / 100,
	}));
}

function bruteForceBest(items: readonly SprintCandidate[], capacity: number): number {
	let best = 0;
	const n = items.length;
	for (let mask = 0; mask < 1 << n; mask++) {
		let weight = 0;
		let value = 0;
		for (let i = 0; i < n; i++) {
			if (mask & (1 << i)) {
				const item = items[i]!;
				weight += item.estimatedMinutes;
				value += item.urgency;
			}
		}
		if (weight <= capacity && value > best) {
			best = value;
		}
	}
	return best;
}

describe('scheduleSprint', () => {
	it('matches brute force on 200 seeded random inputs', () => {
		const rand = mulberry32(42);
		for (let trial = 0; trial < 200; trial++) {
			const n = 1 + Math.floor(rand() * 12);
			const capacity = Math.floor(rand() * 40);
			const items = randomCandidates(rand, n);

			const chosen = scheduleSprint(items, capacity);
			const chosenWeight = chosen.reduce((sum, item) => sum + item.estimatedMinutes, 0);
			const chosenValue = chosen.reduce((sum, item) => sum + item.urgency, 0);

			expect(chosenWeight).toBeLessThanOrEqual(capacity);
			expect(chosenValue).toBeCloseTo(bruteForceBest(items, capacity), 6);
		}
	});
});

describe('scheduleSprint edge cases and ordering', () => {
	it('returns [] for empty input or non-positive capacity', () => {
		const items: SprintCandidate[] = [{ id: 'a', estimatedMinutes: 1, urgency: 1 }];
		expect(scheduleSprint([], 10)).toEqual([]);
		expect(scheduleSprint(items, 0)).toEqual([]);
		expect(scheduleSprint(items, -5)).toEqual([]);
	});

	it('selects nothing when every item is too big', () => {
		const items: SprintCandidate[] = [
			{ id: 'a', estimatedMinutes: 11, urgency: 100 },
			{ id: 'b', estimatedMinutes: 20, urgency: 50 },
		];
		expect(scheduleSprint(items, 10)).toEqual([]);
	});

	it('packs an exact fit', () => {
		const items: SprintCandidate[] = [
			{ id: 'a', estimatedMinutes: 3, urgency: 1 },
			{ id: 'b', estimatedMinutes: 5, urgency: 1 },
			{ id: 'c', estimatedMinutes: 8, urgency: 1.5 },
		];
		// a + b fills 8 minutes exactly for 2 urgency, beating c alone at 1.5.
		expect(scheduleSprint(items, 8).map((item) => item.id)).toEqual(['a', 'b']);
		// With capacity 9 the same pair still wins over c (c alone leaves 1 minute unused).
		expect(scheduleSprint(items, 7).map((item) => item.id)).toEqual(['a']);
	});

	it('is deterministic on ties regardless of input order', () => {
		const base: SprintCandidate[] = [
			{ id: 'b', estimatedMinutes: 2, urgency: 5 },
			{ id: 'a', estimatedMinutes: 2, urgency: 5 },
			{ id: 'c', estimatedMinutes: 2, urgency: 5 },
		];
		const forward = scheduleSprint(base, 4).map((item) => item.id);
		const reversed = scheduleSprint([...base].reverse(), 4).map((item) => item.id);
		expect(forward).toEqual(['a', 'b']);
		expect(reversed).toEqual(forward);
	});

	it('returns items in urgency-desc, id-asc order', () => {
		const items: SprintCandidate[] = [
			{ id: 'low', estimatedMinutes: 1, urgency: 1 },
			{ id: 'high', estimatedMinutes: 1, urgency: 9 },
			{ id: 'mid', estimatedMinutes: 1, urgency: 5 },
		];
		expect(scheduleSprint(items, 10).map((item) => item.id)).toEqual(['high', 'mid', 'low']);
	});

	it('only considers the first MAX_CANDIDATES after sorting', () => {
		const items: SprintCandidate[] = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => ({
			id: `c${String(i).padStart(5, '0')}`,
			estimatedMinutes: 1,
			urgency: i === 0 ? 0 : 1,
		}));
		const chosen = scheduleSprint(items, MAX_CANDIDATES + 1).map((item) => item.id);
		expect(chosen).toHaveLength(MAX_CANDIDATES);
		expect(chosen).not.toContain(`c${String(0).padStart(5, '0')}`);
	});
});
