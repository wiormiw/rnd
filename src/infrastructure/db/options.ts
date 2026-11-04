import type { Options } from 'postgres';
import type { Logger } from '../../lib/logger.js';
import type { DbEnv } from './env.js';

/** Drop `undefined` entries so they are not sent as run-time parameters. */
function compact<T extends Record<string, string | number | boolean | undefined>>(
	input: T,
): Record<string, string | number | boolean> {
	return Object.fromEntries(
		Object.entries(input).filter((entry): entry is [string, string | number | boolean] => {
			return entry[1] !== undefined;
		}),
	);
}

/**
 * Translate the validated environment into postgres.js options. Callbacks are
 * wired to the logger. Query parameters are never logged: they may be secrets.
 */
export function toPostgresOptions(env: DbEnv, logger: Logger): Options {
	return {
		ssl: env.DB_SSL,
		sslnegotiation: env.DB_SSL_NEGOTIATION,
		channel_binding: env.DB_CHANNEL_BINDING,

		max: env.DB_MAX,
		min: env.DB_MIN,
		max_pipeline: env.DB_MAX_PIPELINE,
		scheduler: env.DB_SCHEDULER,
		idle_timeout: env.DB_IDLE_TIMEOUT,
		queue_timeout: env.DB_QUEUE_TIMEOUT,
		connect_timeout: env.DB_CONNECT_TIMEOUT,
		max_lifetime: env.DB_MAX_LIFETIME,
		backoff: env.DB_BACKOFF,
		keep_alive: env.DB_KEEP_ALIVE,

		prepare: env.DB_PREPARE,
		infer: env.DB_INFER,
		fetch_types: env.DB_FETCH_TYPES,
		target_session_attrs: env.DB_TARGET_SESSION_ATTRS,

		publications: env.DB_PUBLICATIONS,
		slot: env.DB_SLOT,

		onread: env.DB_ONREAD,
		unref_sockets: env.DB_UNREF_SOCKETS,

		connection: compact({
			application_name: env.DB_APPLICATION_NAME,
			statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
			lock_timeout: env.DB_LOCK_TIMEOUT_MS,
			idle_in_transaction_session_timeout: env.DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS,
			idle_session_timeout: env.DB_IDLE_SESSION_TIMEOUT_MS,
			TimeZone: env.DB_TIMEZONE,
			default_transaction_isolation: env.DB_DEFAULT_TRANSACTION_ISOLATION,
			default_transaction_read_only: env.DB_DEFAULT_TRANSACTION_READ_ONLY,
		}),

		onnotice: (notice) => logger.debug({ notice }, 'postgres notice'),
		onparameter: (key, value) => logger.trace({ key, value }, 'postgres parameter changed'),
		onclose: (connection) => logger.debug({ connection }, 'postgres connection closed'),
		debug: env.DB_DEBUG
			? (connection, query, parameters) =>
					logger.debug({ connection, query, parameters: parameters.length }, 'postgres query')
			: false,
	};
}
