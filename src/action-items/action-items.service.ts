import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock.js';
import { errors } from '../common/errors.js';
import { currentLogger } from '../common/request-context.js';
import { err, ok, type Result } from '../common/result.js';
import { toPage, type Page } from '../common/schemas.js';
import type { ActionItem, ActionItemListQuery } from './action-item.schema.js';
import { ActionItemsRepository } from './action-items.repository.js';

@Injectable()
export class ActionItemsService {
	constructor(
		private readonly repository: ActionItemsRepository,
		@Inject(CLOCK) private readonly clock: Clock,
	) {}

	async list(query: ActionItemListQuery): Promise<Result<Page<ActionItem>>> {
		const { items, total } = await this.repository.list(query);
		return ok(toPage(items, total, query));
	}

	async complete(id: string): Promise<Result<ActionItem>> {
		const outcome = await this.repository.complete(id, this.clock.now());
		if (outcome.kind === 'not_found') return err(errors.notFound('action item', id));
		if (outcome.kind === 'already_done')
			return err(errors.conflict('action item already completed'));
		currentLogger().info(
			{ actionItemId: id, cardId: outcome.item.cardId },
			'action item completed',
		);
		return ok(outcome.item);
	}
}
