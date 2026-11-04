import type { Database } from '../infrastructure/db/client.js';
import type { Logger } from '../lib/logger.js';
import { createMemoRepository } from './memos/repository.js';
import { createMemoService } from './memos/service.js';

/** Composition of the data layer: the only place that knows the concrete repositories. */
export function createRepositories(db: Database) {
	return { memos: createMemoRepository(db) };
}

export type Repositories = ReturnType<typeof createRepositories>;

/** Composition of the business layer. Takes repositories so tests can swap them. */
export function createServices(repositories: Repositories, logger: Logger) {
	return { memos: createMemoService({ repository: repositories.memos, logger }) };
}

export type Services = ReturnType<typeof createServices>;
