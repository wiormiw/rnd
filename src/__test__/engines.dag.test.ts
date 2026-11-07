import { describe, expect, it } from 'vitest';
import { topologicalOrder, unlockedTopicIds, wouldCreateCycle } from '../engines/dag.js';
import type { Edge } from '../engines/dag.js';

const at = (iso: string) => new Date(iso);

describe('wouldCreateCycle', () => {
	it('detects a self-edge', () => {
		expect(wouldCreateCycle([], 'A', 'A')).toEqual(['A', 'A']);
	});

	it('detects a direct cycle', () => {
		const edges: Edge[] = [{ topicId: 'B', prerequisiteId: 'A' }];
		expect(wouldCreateCycle(edges, 'A', 'B')).toEqual(['A', 'B', 'A']);
	});

	it('returns the exact path for an indirect cycle', () => {
		// B depends on C, C depends on A. Adding A depends on B closes the loop.
		const edges: Edge[] = [
			{ topicId: 'B', prerequisiteId: 'C' },
			{ topicId: 'C', prerequisiteId: 'A' },
		];
		expect(wouldCreateCycle(edges, 'A', 'B')).toEqual(['A', 'B', 'C', 'A']);
	});

	it('returns null when no cycle would form', () => {
		const edges: Edge[] = [
			{ topicId: 'B', prerequisiteId: 'A' },
			{ topicId: 'C', prerequisiteId: 'B' },
		];
		expect(wouldCreateCycle(edges, 'C', 'A')).toBeNull();
		expect(wouldCreateCycle(edges, 'A', 'C')).toEqual(['A', 'C', 'B', 'A']);
	});
});

describe('topologicalOrder', () => {
	const topics = [
		{ id: 'd', createdAt: at('2026-01-03') },
		{ id: 'a', createdAt: at('2026-01-02') },
		{ id: 'b', createdAt: at('2026-01-02') },
		{ id: 'c', createdAt: at('2026-01-01') },
	];

	it('puts prerequisites before dependents', () => {
		const edges: Edge[] = [
			{ topicId: 'd', prerequisiteId: 'a' },
			{ topicId: 'd', prerequisiteId: 'b' },
		];
		const order = topologicalOrder(topics, edges).map((t) => t.id);
		expect(order.indexOf('a')).toBeLessThan(order.indexOf('d'));
		expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
	});

	it('breaks ties by createdAt, then id', () => {
		// No edges: pure tie-breaking. c is oldest; a and b share a date so id decides.
		expect(topologicalOrder(topics, []).map((t) => t.id)).toEqual(['c', 'a', 'b', 'd']);
	});

	it('ignores edges referencing unknown ids', () => {
		const edges: Edge[] = [{ topicId: 'zzz', prerequisiteId: 'a' }];
		expect(topologicalOrder(topics, edges).map((t) => t.id)).toEqual(['c', 'a', 'b', 'd']);
	});

	it('throws when a cycle is present', () => {
		const pair = [
			{ id: 'x', createdAt: at('2026-01-01') },
			{ id: 'y', createdAt: at('2026-01-01') },
		];
		const edges: Edge[] = [
			{ topicId: 'x', prerequisiteId: 'y' },
			{ topicId: 'y', prerequisiteId: 'x' },
		];
		expect(() => topologicalOrder(pair, edges)).toThrow(Error);
	});
});

describe('unlockedTopicIds', () => {
	const edges: Edge[] = [
		{ topicId: 'B', prerequisiteId: 'A' },
		{ topicId: 'C', prerequisiteId: 'B' },
		{ topicId: 'D', prerequisiteId: 'A' },
		{ topicId: 'D', prerequisiteId: 'X' },
	];

	it('unlocks topics without prerequisites', () => {
		expect(unlockedTopicIds(['A', 'Z'], edges, new Set())).toEqual(new Set(['A', 'Z']));
	});

	it('requires every direct prerequisite to be mastered', () => {
		expect(unlockedTopicIds(['B', 'D'], edges, new Set(['A']))).toEqual(new Set(['B']));
		expect(unlockedTopicIds(['D'], edges, new Set(['A', 'X']))).toEqual(new Set(['D']));
	});

	it('propagates unlocks only through direct prerequisites', () => {
		// C depends on B; mastering A alone is not enough to unlock C.
		expect(unlockedTopicIds(['C'], edges, new Set(['A']))).toEqual(new Set());
		expect(unlockedTopicIds(['C'], edges, new Set(['A', 'B']))).toEqual(new Set(['C']));
	});
});
