import { Injectable } from '@nestjs/common';
import { createLogger } from '../common/logger.js';
import { errors } from '../common/errors.js';
import { currentLogger } from '../common/request-context.js';
import { err, fromNullable, ok, type Result } from '../common/result.js';
import type { Page, Pagination } from '../common/schemas.js';
import { CardsRepository } from './cards.repository.js';
import type { Card, CardInsert, CardUpdate } from './card.schema.js';

@Injectable()
export class CardsService {
	private readonly fallbackLog = createLogger({ level: 'info', name: 'rnd' });

	constructor(private readonly repository: CardsRepository) {}

	async create(topicId: string, input: CardInsert): Promise<Result<Card>> {
		if (!(await this.repository.topicExists(topicId)))
			return err(errors.notFound('topic', topicId));
		const memoMissing = await this.missingMemo(input.memoId);
		if (memoMissing) return err(memoMissing);

		const card = await this.repository.insert(topicId, input);
		currentLogger(this.fallbackLog).info({ cardId: card.id, topicId }, 'card created');
		return ok(card);
	}

	async listByTopic(topicId: string, page: Pagination): Promise<Result<Page<Card>>> {
		if (!(await this.repository.topicExists(topicId)))
			return err(errors.notFound('topic', topicId));
		const { items, total } = await this.repository.listByTopic(topicId, page);
		return ok({ items, total, limit: page.limit, offset: page.offset });
	}

	async findById(id: string): Promise<Result<Card>> {
		return fromNullable(await this.repository.findById(id), () => errors.notFound('card', id));
	}

	async update(id: string, patch: CardUpdate): Promise<Result<Card>> {
		if (!(await this.repository.findById(id))) return err(errors.notFound('card', id));
		const memoMissing = await this.missingMemo(patch.memoId);
		if (memoMissing) return err(memoMissing);

		const card = await this.repository.update(id, patch);
		if (!card) return err(errors.notFound('card', id));
		currentLogger(this.fallbackLog).info({ cardId: id }, 'card updated');
		return ok(card);
	}

	async remove(id: string): Promise<Result<void>> {
		const removed = await this.repository.remove(id);
		if (!removed) return err(errors.notFound('card', id));
		currentLogger(this.fallbackLog).info({ cardId: id }, 'card removed');
		return ok(undefined);
	}

	/** A memo reference is only checked when one is given (null clears it). */
	private async missingMemo(memoId: string | null | undefined) {
		if (!memoId) return undefined;
		return (await this.repository.memoExists(memoId)) ? undefined : errors.notFound('memo', memoId);
	}
}
