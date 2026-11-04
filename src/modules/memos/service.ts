import { errors } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { currentLogger } from '../../lib/request-context.js';
import { err, fromNullable, ok, type Result } from '../../lib/result.js';
import type { Page, Pagination } from '../../lib/schemas.js';
import type { MemoRepository } from './repository.js';
import type { CreateMemoInput, Memo } from './schema.js';

/**
 * Business rules. Expected failures come back as `Result` errors built by the
 * `errors` factory: nothing here knows about HTTP.
 */
export interface MemoService {
	create(input: CreateMemoInput): Promise<Result<Memo>>;
	get(id: string): Promise<Result<Memo>>;
	list(page: Pagination): Promise<Result<Page<Memo>>>;
	remove(id: string): Promise<Result<void>>;
}

export interface MemoServiceDeps {
	repository: MemoRepository;
	logger: Logger;
}

export function createMemoService({ repository, logger }: MemoServiceDeps): MemoService {
	return {
		async create(input) {
			const memo = await repository.insert(input);
			// Picks up the request id from AsyncLocalStorage, no parameter needed.
			currentLogger(logger).info({ memoId: memo.id }, 'memo created');
			return ok(memo);
		},

		async get(id) {
			return fromNullable(await repository.findById(id), () => errors.notFound('memo', id));
		},

		async list(page) {
			const { items, total } = await repository.list(page);
			return ok({ items, total, limit: page.limit, offset: page.offset });
		},

		async remove(id) {
			const removed = await repository.remove(id);
			if (!removed) return err(errors.notFound('memo', id));
			currentLogger(logger).info({ memoId: id }, 'memo removed');
			return ok(undefined);
		},
	};
}
