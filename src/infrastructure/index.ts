import { Lifecycle, type LifecycleTimeouts } from '../lib/lifecycle.js';
import type { Logger } from '../lib/logger.js';
import { createDatabase } from './db/client.js';
import type { DbEnv } from './db/env.js';
import { createRedis } from './cache/client.js';
import type { RedisEnv } from './cache/env.js';

export interface InfrastructureEnv extends DbEnv, RedisEnv {
	LIFECYCLE_START_TIMEOUT_MS: number;
	LIFECYCLE_STOP_TIMEOUT_MS: number;
	LIFECYCLE_CHECK_TIMEOUT_MS: number;
}

/**
 * The single place that knows which infrastructure exists. To add one: create
 * `infrastructure/<name>/` exposing a `Resource` and its env schema, then add
 * its resource to the list below. Order matters: resources start top to bottom
 * and stop bottom to top.
 */
export function createInfrastructure(env: InfrastructureEnv, logger: Logger) {
	const database = createDatabase(env, logger);
	const redis = createRedis(env, logger);

	const timeouts: LifecycleTimeouts = {
		startMs: env.LIFECYCLE_START_TIMEOUT_MS,
		stopMs: env.LIFECYCLE_STOP_TIMEOUT_MS,
		checkMs: env.LIFECYCLE_CHECK_TIMEOUT_MS,
	};
	const lifecycle = new Lifecycle([database.resource, redis.resource], logger, timeouts);

	return {
		lifecycle,
		db: database.db,
		redis: redis.client,
		/** Stops every resource, in reverse start order. */
		async [Symbol.asyncDispose]() {
			await lifecycle.stop();
		},
	};
}

export type Infrastructure = ReturnType<typeof createInfrastructure>;
