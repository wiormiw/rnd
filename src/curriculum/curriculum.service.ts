import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock.js';
import { errors } from '../common/errors.js';
import { currentLogger } from '../common/request-context.js';
import { err, ok, type Result } from '../common/result.js';
import {
	isMastered,
	topologicalOrder,
	unlockedTopicIds,
	wouldCreateCycle,
	type Edge,
} from '../engines/index.js';
import { CurriculumRepository } from './curriculum.repository.js';
import type { Topic, TopicInsert, TopicRow, TopicStatus, TopicUpdate } from './topic.schema.js';

interface Snapshot {
	topics: TopicRow[];
	edges: Edge[];
	status: Map<string, TopicStatus>;
}

@Injectable()
export class CurriculumService {
	constructor(
		private readonly repository: CurriculumRepository,
		@Inject(CLOCK) private readonly clock: Clock,
	) {}

	async create(input: TopicInsert): Promise<Result<Topic>> {
		const row = await this.repository.insertTopic(input, this.clock.now());
		currentLogger().info({ topicId: row.id }, 'topic created');
		return ok({ ...row, prerequisiteIds: [], cardCount: 0, mastered: true, unlocked: true });
	}

	async list(): Promise<Result<Topic[]>> {
		const { topics, status } = await this.snapshot();
		return ok(topics.map((topic) => withStatus(topic, status)));
	}

	async findById(id: string): Promise<Result<Topic>> {
		const { topics, status } = await this.snapshot();
		const topic = topics.find((t) => t.id === id);
		if (!topic) return err(errors.notFound('topic', id));
		return ok(withStatus(topic, status));
	}

	async update(id: string, patch: TopicUpdate): Promise<Result<Topic>> {
		const row = await this.repository.updateTopic(id, patch, this.clock.now());
		if (!row) return err(errors.notFound('topic', id));
		currentLogger().info({ topicId: id }, 'topic updated');
		return this.findById(id);
	}

	async remove(id: string): Promise<Result<void>> {
		const removed = await this.repository.removeTopic(id);
		if (!removed) return err(errors.notFound('topic', id));
		currentLogger().info({ topicId: id }, 'topic removed');
		return ok(undefined);
	}

	async addPrerequisite(topicId: string, prerequisiteId: string): Promise<Result<void>> {
		const missing = await this.missingTopic(topicId, prerequisiteId);
		if (missing) return err(missing);
		if (topicId === prerequisiteId) return err(cycleConflict([topicId, topicId]));

		const outcome = await this.repository.addPrerequisite(topicId, prerequisiteId, (edges) =>
			wouldCreateCycle(edges, topicId, prerequisiteId),
		);
		if ('cycle' in outcome) return err(cycleConflict(outcome.cycle));
		currentLogger().info({ topicId, prerequisiteId }, 'prerequisite added');
		return ok(undefined);
	}

	async removePrerequisite(topicId: string, prerequisiteId: string): Promise<Result<void>> {
		const removed = await this.repository.removePrerequisite(topicId, prerequisiteId);
		if (!removed) return err(errors.notFound('prerequisite', `${topicId}/${prerequisiteId}`));
		return ok(undefined);
	}

	/** Topics with prerequisites before dependents. */
	async order(): Promise<Result<Topic[]>> {
		const { topics, edges, status } = await this.snapshot();
		return ok(topologicalOrder(topics, edges).map((topic) => withStatus(topic, status)));
	}

	/** Ids of topics whose prerequisites are all mastered; the schedule module builds on this. */
	async unlockedIds(): Promise<Set<string>> {
		const { status } = await this.snapshot();
		return new Set([...status].filter(([, s]) => s.unlocked).map(([id]) => id));
	}

	private async missingTopic(topicId: string, prerequisiteId: string) {
		if (!(await this.repository.findTopic(topicId))) return errors.notFound('topic', topicId);
		if (!(await this.repository.findTopic(prerequisiteId))) {
			return errors.notFound('prerequisite topic', prerequisiteId);
		}
		return undefined;
	}

	private async snapshot(): Promise<Snapshot> {
		const [topics, edges, inputs] = await Promise.all([
			this.repository.listTopics(),
			this.repository.listEdges(),
			this.repository.masteryInputs(),
		]);
		const pending = new Set(inputs.pendingCardIds);
		const cardsByTopic = Map.groupBy(inputs.cards, (card) => card.topicId);

		const mastered = new Set<string>();
		for (const topic of topics) {
			const cards = (cardsByTopic.get(topic.id) ?? []).map((c) => ({
				id: c.id,
				repetition: c.smRepetition,
			}));
			if (isMastered(cards, pending)) mastered.add(topic.id);
		}
		const unlocked = unlockedTopicIds(
			topics.map((t) => t.id),
			edges,
			mastered,
		);

		const status = new Map<string, TopicStatus>(
			topics.map((topic) => [
				topic.id,
				{
					prerequisiteIds: edges.filter((e) => e.topicId === topic.id).map((e) => e.prerequisiteId),
					cardCount: cardsByTopic.get(topic.id)?.length ?? 0,
					mastered: mastered.has(topic.id),
					unlocked: unlocked.has(topic.id),
				},
			]),
		);
		return { topics, edges, status };
	}
}

function withStatus(topic: TopicRow, status: Map<string, TopicStatus>): Topic {
	const s = status.get(topic.id);
	if (!s) throw new Error(`no status computed for topic ${topic.id}`);
	return { ...topic, ...s };
}

function cycleConflict(cycle: string[]) {
	return errors.conflict('prerequisite would create a cycle', { cycle });
}
