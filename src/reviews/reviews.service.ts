import { Inject, Injectable } from '@nestjs/common';
import type { ActionItem } from '../action-items/action-item.schema.js';
import type { Card } from '../cards/card.schema.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { errors } from '../common/errors.js';
import { createLogger } from '../common/logger.js';
import { currentLogger } from '../common/request-context.js';
import { err, ok, type Result } from '../common/result.js';
import type { Page, Pagination } from '../common/schemas.js';
import { decideReview } from '../engines/index.js';
import type { ReviewInsert, ReviewLog } from './review.schema.js';
import { ReviewsRepository } from './reviews.repository.js';

export interface ReviewResult {
	card: Card;
	nextReviewAt: Date;
	actionItem: ActionItem | null;
}

@Injectable()
export class ReviewsService {
	private readonly fallbackLog = createLogger({ level: 'info', name: 'rnd' });

	constructor(
		private readonly repository: ReviewsRepository,
		@Inject(CLOCK) private readonly clock: Clock,
	) {}

	async review(cardId: string, input: ReviewInsert): Promise<Result<ReviewResult>> {
		const now = this.clock.now();
		const outcome = await this.repository.applyReview(cardId, (card) =>
			decideReview(card, input, now),
		);
		if (outcome.kind === 'not_found') return err(errors.notFound('card', cardId));
		if (outcome.kind === 'pending') {
			return err(
				errors.conflict('card has a pending practice task', { actionItemId: outcome.actionItemId }),
			);
		}
		currentLogger(this.fallbackLog).info(
			{
				cardId,
				qualityScore: input.qualityScore,
				interval: outcome.card.smInterval,
				actionItemId: outcome.actionItem?.id,
			},
			'card reviewed',
		);
		return ok({
			card: outcome.card,
			nextReviewAt: outcome.card.nextReviewAt,
			actionItem: outcome.actionItem,
		});
	}

	async listByCard(cardId: string, page: Pagination): Promise<Result<Page<ReviewLog>>> {
		if (!(await this.repository.cardExists(cardId))) return err(errors.notFound('card', cardId));
		const { items, total } = await this.repository.listByCard(cardId, page);
		return ok({ items, total, limit: page.limit, offset: page.offset });
	}
}
