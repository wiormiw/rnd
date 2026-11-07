import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Options } from 'postgres';
import type { Logger } from '../common/logger.js';
import type { DbEnv } from './env.js';
import { toPostgresOptions } from './options.js';

/**
 * Create the pool and its lifecycle. postgres.js connects lazily, so nothing
 * touches the network until the resource starts (or the first query runs).
 *
 * @param overrides postgres.js options that cannot come from the environment
 *   (transform, types, socket, function-valued user/password...). They win over
 *   the environment.
 */
export function createDatabase(env: DbEnv, logger: Logger, overrides: Options = {}) {
	const log = logger.child({ component: 'db' });
	const client = postgres(env.DB_URL, { ...toPostgresOptions(env, log), ...overrides });
	const db = drizzle({ client });

	const ping = async (signal: AbortSignal) => {
		// `.signal()` cancels the query on the server when the signal aborts.
		await client`select 1`.signal(signal);
	};

	// Lets stop() skip draining a pool that never came up (failed or aborted start).
	let ready = false;

	// Graceful only if the pool ever came up; otherwise there is nothing to drain.
	const end = () => client.end({ timeout: ready ? env.DB_END_TIMEOUT : 0 });

	return {
		db,
		client,
		ping,
		/** `await using database = createDatabase(...)` closes the pool on scope exit. */
		async [Symbol.asyncDispose]() {
			await end();
		},
	};
}

export type Database = ReturnType<typeof createDatabase>['db'];
