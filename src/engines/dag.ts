export interface Edge {
	topicId: string; // topicId depends on prerequisiteId
	prerequisiteId: string;
}

export interface TopicRef {
	id: string;
	createdAt: Date;
}

function prerequisitesOf(edges: readonly Edge[], topicId: string): string[] {
	return edges.filter((edge) => edge.topicId === topicId).map((edge) => edge.prerequisiteId);
}

/**
 * Returns the cycle that adding "topicId depends on prerequisiteId" would close,
 * as [topicId, prerequisiteId, ..., topicId], or null if no cycle would form.
 */
export function wouldCreateCycle(
	edges: readonly Edge[],
	topicId: string,
	prerequisiteId: string,
): string[] | null {
	if (topicId === prerequisiteId) {
		return [topicId, topicId];
	}

	// BFS from prerequisiteId along "depends on" edges, looking for topicId.
	const parent = new Map<string, string>();
	const visited = new Set<string>([prerequisiteId]);
	const queue: string[] = [prerequisiteId];

	for (let head = 0; head < queue.length; head++) {
		const current = queue[head]!;
		for (const next of prerequisitesOf(edges, current)) {
			if (visited.has(next)) {
				continue;
			}
			visited.add(next);
			parent.set(next, current);
			if (next === topicId) {
				const chain: string[] = [topicId];
				let node = topicId;
				while (node !== prerequisiteId) {
					node = parent.get(node)!;
					chain.push(node);
				}
				// chain is [topicId, ..., prerequisiteId]; reverse to walk prerequisite-first.
				chain.reverse();
				return [topicId, ...chain];
			}
			queue.push(next);
		}
	}

	return null;
}

function compareTopics(a: TopicRef, b: TopicRef): number {
	const diff = a.createdAt.getTime() - b.createdAt.getTime();
	if (diff !== 0) {
		return diff;
	}
	if (a.id < b.id) {
		return -1;
	}
	return a.id > b.id ? 1 : 0;
}

/** Inserts into a list kept sorted by compareTopics. */
function insertReady<T extends TopicRef>(ready: T[], topic: T): void {
	const index = ready.findIndex((item) => compareTopics(topic, item) < 0);
	if (index === -1) {
		ready.push(topic);
	} else {
		ready.splice(index, 0, topic);
	}
}

interface Graph<T> {
	byId: Map<string, T>;
	indegree: Map<string, number>;
	dependents: Map<string, string[]>;
}

/** Builds Kahn's bookkeeping; edges touching unknown ids are ignored. */
function buildGraph<T extends TopicRef>(topics: readonly T[], edges: readonly Edge[]): Graph<T> {
	const byId = new Map<string, T>(topics.map((topic) => [topic.id, topic]));
	const indegree = new Map<string, number>([...byId.keys()].map((id) => [id, 0]));
	const dependents = new Map<string, string[]>();

	for (const edge of edges) {
		if (!byId.has(edge.topicId) || !byId.has(edge.prerequisiteId)) {
			continue;
		}
		indegree.set(edge.topicId, indegree.get(edge.topicId)! + 1);
		dependents.set(edge.prerequisiteId, [
			...(dependents.get(edge.prerequisiteId) ?? []),
			edge.topicId,
		]);
	}

	return { byId, indegree, dependents };
}

export function topologicalOrder<T extends TopicRef>(
	topics: readonly T[],
	edges: readonly Edge[],
): T[] {
	const { byId, indegree, dependents } = buildGraph(topics, edges);

	const ready: T[] = [];
	for (const topic of byId.values()) {
		if (indegree.get(topic.id) === 0) {
			insertReady(ready, topic);
		}
	}

	const result: T[] = [];
	while (ready.length > 0) {
		const next = ready.shift()!;
		result.push(next);
		for (const dependentId of dependents.get(next.id) ?? []) {
			const remaining = indegree.get(dependentId)! - 1;
			indegree.set(dependentId, remaining);
			if (remaining === 0) {
				insertReady(ready, byId.get(dependentId)!);
			}
		}
	}

	if (result.length !== byId.size) {
		throw new Error('Cycle detected in topic prerequisites');
	}

	return result;
}

/**
 * A topic is unlocked iff every direct prerequisite is mastered.
 * Topics without prerequisites are unlocked.
 */
export function unlockedTopicIds(
	topicIds: readonly string[],
	edges: readonly Edge[],
	masteredIds: ReadonlySet<string>,
): Set<string> {
	const unlocked = new Set<string>();
	for (const topicId of topicIds) {
		if (prerequisitesOf(edges, topicId).every((id) => masteredIds.has(id))) {
			unlocked.add(topicId);
		}
	}
	return unlocked;
}
