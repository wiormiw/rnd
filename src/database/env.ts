import * as z from 'zod';
import { intEnv } from '../common/env.js';

/**
 * Environment variables for the postgres.js client. Names follow the option
 * they set. Durations are in SECONDS unless the name ends in `_MS`.
 *
 * Host, port, database, user and password come from DB_URL. Options that are
 * functions (transform, types, socket, backoff functions...) are not
 * representable here: pass them as `overrides` to `createDatabase`.
 */
export const dbEnvSchema = z.object({
	DB_URL: z.url(),

	// TLS
	DB_SSL: z.enum(['disable', 'allow', 'prefer', 'require', 'verify-full']).optional(),
	DB_SSL_NEGOTIATION: z.enum(['postgres', 'direct']).optional(),
	DB_CHANNEL_BINDING: z.enum(['disable', 'prefer', 'require']).optional(),

	// Pool
	DB_MAX: intEnv(1).default(10),
	DB_MIN: intEnv(0).default(0),
	DB_MAX_PIPELINE: intEnv(1).default(100),
	DB_SCHEDULER: z.stringbool().default(true),
	/** Seconds before an idle connection closes. 0 keeps it open. */
	DB_IDLE_TIMEOUT: intEnv(0).default(30),
	/** Seconds a query may wait for a free connection. 0 waits forever. */
	DB_QUEUE_TIMEOUT: intEnv(0).default(10),
	DB_CONNECT_TIMEOUT: intEnv(0).default(10),
	/** Seconds a connection lives at most. Unset keeps the driver default (30-60 min). */
	DB_MAX_LIFETIME: intEnv(0).optional(),
	/** Seconds before reconnecting after a failure. Unset keeps exponential backoff. */
	DB_BACKOFF: intEnv(0).optional(),
	/** Seconds of TCP keep-alive. 0 disables it. */
	DB_KEEP_ALIVE: intEnv(0).default(60),

	// Protocol and types
	/** Set to false behind PgBouncer in transaction pooling mode. */
	DB_PREPARE: z.stringbool().default(true),
	DB_INFER: z.stringbool().default(false),
	DB_FETCH_TYPES: z.stringbool().default(true),
	DB_TARGET_SESSION_ATTRS: z
		.enum(['read-write', 'read-only', 'primary', 'standby', 'prefer-standby'])
		.optional(),

	// Logical replication (sql.subscribe)
	DB_PUBLICATIONS: z.string().min(1).optional(),
	DB_SLOT: z.string().min(1).optional(),

	// Sockets
	DB_ONREAD: z.stringbool().default(true),
	DB_UNREF_SOCKETS: z.stringbool().default(false),

	/** Log every query (without parameter values) at debug level. */
	DB_DEBUG: z.stringbool().default(false),

	// Run-time parameters sent at startup (the `connection` option)
	DB_APPLICATION_NAME: z.string().min(1).default('rnd'),
	DB_STATEMENT_TIMEOUT_MS: intEnv(0).default(30_000),
	DB_LOCK_TIMEOUT_MS: intEnv(0).optional(),
	DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: intEnv(0).default(60_000),
	DB_IDLE_SESSION_TIMEOUT_MS: intEnv(0).optional(),
	DB_TIMEZONE: z.string().min(1).optional(),
	DB_DEFAULT_TRANSACTION_ISOLATION: z
		.enum(['read uncommitted', 'read committed', 'repeatable read', 'serializable'])
		.optional(),
	DB_DEFAULT_TRANSACTION_READ_ONLY: z.stringbool().optional(),

	/** Seconds to let in-flight queries finish when closing the pool. */
	DB_END_TIMEOUT: intEnv(0).default(5),
});

export type DbEnv = z.infer<typeof dbEnvSchema>;
