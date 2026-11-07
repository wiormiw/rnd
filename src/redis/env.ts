import * as z from 'zod';

const int = (min = 0) => z.coerce.number().int().min(min);

/** Environment variables for the node-redis client. Durations are in milliseconds. */
export const redisEnvSchema = z.object({
	REDIS_URL: z.url(),
	/** Prepended to every key this client sends, so apps can share one Redis. */
	REDIS_KEY_PREFIX: z.string().default('rnd:'),
	/** Shown in `CLIENT LIST`. */
	REDIS_CLIENT_NAME: z.string().min(1).default('rnd'),
	REDIS_DATABASE: int(0).optional(),
	REDIS_CONNECT_TIMEOUT_MS: int(1).default(5_000),
	/** Close a socket that has been silent this long. Blank = no timeout. */
	REDIS_SOCKET_TIMEOUT_MS: int(1).optional(),
	/** Send PING this often to keep idle connections alive. Blank = never. */
	REDIS_PING_INTERVAL_MS: int(1).optional(),
	/** Fail commands immediately while disconnected instead of queueing them. */
	REDIS_DISABLE_OFFLINE_QUEUE: z.stringbool().default(true),
	/** Reconnect attempts allowed during startup before giving up. */
	REDIS_STARTUP_RETRIES: int(0).default(2),
});

export type RedisEnv = z.infer<typeof redisEnvSchema>;
