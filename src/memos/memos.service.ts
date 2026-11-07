import { Injectable } from '@nestjs/common';
import { createLogger } from '../common/logger.js';
import { errors } from '../common/errors.js';
import { currentLogger } from '../common/request-context.js';
import { err, fromNullable, ok, type Result } from '../common/result.js';
import type { Page, Pagination } from '../common/schemas.js';
import { MemosRepository } from './memos.repository.js';
import type { Memo, MemoInsert, MemoUpdate } from './memo.schema.js';

/**
 * Business rules. Expected failures come back as `Result` errors built by the
 * `errors` factory: nothing here knows about HTTP.
 */
@Injectable()
export class MemosService {
	private readonly fallbackLog = createLogger({ level: 'info', name: 'rnd' });

	constructor(private readonly repository: MemosRepository) {}

	async create(input: MemoInsert): Promise<Result<Memo>> {
		const memo = await this.repository.insert(input);
		// Picks up the request id from AsyncLocalStorage, no parameter needed.
		currentLogger(this.fallbackLog).info({ memoId: memo.id }, 'memo created');
		return ok(memo);
	}

	async findById(id: string): Promise<Result<Memo>> {
		return fromNullable(await this.repository.findById(id), () => errors.notFound('memo', id));
	}

	async update(id: string, patch: MemoUpdate): Promise<Result<Memo>> {
		const memo = await this.repository.update(id, patch);
		if (!memo) return err(errors.notFound('memo', id));
		currentLogger(this.fallbackLog).info({ memoId: id }, 'memo updated');
		return ok(memo);
	}

	async list(page: Pagination): Promise<Result<Page<Memo>>> {
		const { items, total } = await this.repository.list(page);
		return ok({ items, total, limit: page.limit, offset: page.offset });
	}

	async remove(id: string): Promise<Result<void>> {
		const removed = await this.repository.remove(id);
		if (!removed) return err(errors.notFound('memo', id));
		currentLogger(this.fallbackLog).info({ memoId: id }, 'memo removed');
		return ok(undefined);
	}
}
