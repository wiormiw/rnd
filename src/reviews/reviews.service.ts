import { Inject, Injectable } from '@nestjs/common';
import type { ActionItem } from '../action-items/action-item.schema.js';
import type { Card } from '../cards/card.schema.js';
import { CLOCK, type Clock } from '../common/clock.js';
import { errors } from '../common/errors.js';
import { createLogger } from '../common/logger.js';
import { currentLogger } from '../common/request-context.js';
import { err, ok, type Result } from '../common/result.js';
import type { Page, Pagination } from '../common/schemas.js';
import { calculateSM2 } from '../engines/index.js';
import type { ReviewInsert, ReviewLog } from './review.schema.js';
import { ReviewsRepository, type ReviewDecision } from './reviews.repository.js';

/** A quality score below this spawns a remediation (practice) action item. */
export const REMEDIATION_THRESHOLD = 2;

const TITLE_PREFIX = 'Practice: ';
const TITLE_FRONT_MAX = 180;

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

/** Pure: next SM-2 state, the log row and whether remediation is needed. */
function decideReview(card: Card, input: ReviewInsert, now: Date): ReviewDecision {
	const sm2 = calculateSM2(
		{ interval: card.smInterval, repetition: card.smRepetition, easeFactor: card.smEaseFactor },
		input.qualityScore,
		now,
	);
	return {
		sm2,
		log: {
			qualityScore: input.qualityScore,
			timeSpentSeconds: input.timeSpentSeconds,
			previousInterval: card.smInterval,
			newInterval: sm2.interval,
			previousEaseFactor: card.smEaseFactor,
			newEaseFactor: sm2.easeFactor,
			reviewedAt: now,
		},
		actionItemTitle:
			input.qualityScore < REMEDIATION_THRESHOLD
				? `${TITLE_PREFIX}${card.front.slice(0, TITLE_FRONT_MAX)}`
				: null,
	};
}
