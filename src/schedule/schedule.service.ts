import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock.js';
import { createLogger } from '../common/logger.js';
import { currentLogger } from '../common/request-context.js';
import { ok, type Result } from '../common/result.js';
import { CurriculumService } from '../curriculum/curriculum.service.js';
import { scheduleSprint, urgencyScore } from '../engines/index.js';
import { ScheduleRepository } from './schedule.repository.js';
import type { DailySprint } from './schedule.schema.js';

@Injectable()
export class ScheduleService {
	private readonly fallbackLog = createLogger({ level: 'info', name: 'rnd' });

	constructor(
		private readonly repository: ScheduleRepository,
		private readonly curriculum: CurriculumService,
		@Inject(CLOCK) private readonly clock: Clock,
	) {}

	async daily(maxMinutes: number): Promise<Result<DailySprint>> {
		const now = this.clock.now();
		const [unlocked, due] = await Promise.all([
			this.curriculum.unlockedIds(),
			this.repository.dueCards(now),
		]);

		const candidates = due
			.filter((card) => unlocked.has(card.topicId))
			.map((card) => ({
				id: card.id,
				estimatedMinutes: card.estimatedMinutes,
				urgency: urgencyScore(
					{
						nextReviewAt: card.nextReviewAt,
						interval: card.smInterval,
						priorityWeight: card.priorityWeight,
					},
					now,
				),
				card,
			}));

		const selected = scheduleSprint(candidates, maxMinutes);
		const items = selected.map(({ card, urgency }) => ({
			card: {
				id: card.id,
				topicId: card.topicId,
				front: card.front,
				back: card.back,
				estimatedMinutes: card.estimatedMinutes,
			},
			urgency,
		}));
		const allocatedMinutes = items.reduce((sum, item) => sum + item.card.estimatedMinutes, 0);

		currentLogger(this.fallbackLog).info(
			{ candidates: candidates.length, selected: items.length, allocatedMinutes, maxMinutes },
			'daily sprint generated',
		);
		return ok({
			generatedAt: now,
			maxMinutes,
			totalCards: items.length,
			allocatedMinutes,
			items,
		});
	}
}
