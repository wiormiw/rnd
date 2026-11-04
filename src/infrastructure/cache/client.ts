import { createClient } from 'redis';
import type { Resource } from '../../lib/lifecycle.js';
import type { Logger } from '../../lib/logger.js';
import type { RedisEnv } from './env.js';

function buildClient(
	env: RedisEnv,
	reconnectStrategy: (retries: number, cause: Error) => number | Error,
) {
	return createClient({
		url: env.REDIS_URL,
		name: env.REDIS_CLIENT_NAME,
		keyPrefix: env.REDIS_KEY_PREFIX,
		disableOfflineQueue: env.REDIS_DISABLE_OFFLINE_QUEUE,
		...(env.REDIS_DATABASE !== undefined && { database: env.REDIS_DATABASE }),
		...(env.REDIS_PING_INTERVAL_MS !== undefined && { pingInterval: env.REDIS_PING_INTERVAL_MS }),
		socket: {
			connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
			...(env.REDIS_SOCKET_TIMEOUT_MS !== undefined && {
				socketTimeout: env.REDIS_SOCKET_TIMEOUT_MS,
			}),
			reconnectStrategy,
		},
	});
}

export type RedisClient = ReturnType<typeof buildClient>;

/**
 * A plain Redis client and its lifecycle. Features that need Redis (the rate
 * limiter, a cache...) take the client; nothing feature-specific lives here.
 *
 * node-redis connects on `connect()`, which the resource calls on start.
 */
export function createRedis(env: RedisEnv, logger: Logger) {
	const log = logger.child({ component: 'redis' });
	let ready = false;

	const client = buildClient(env, (retries, cause) => {
		// Before the first successful connection fail fast, so a wrong URL is a
		// clear startup error. Afterwards keep retrying with a capped backoff.
		if (!ready && retries >= env.REDIS_STARTUP_RETRIES) {
			return new Error(`could not reach redis after ${retries + 1} attempts`, { cause });
		}
		return Math.min((retries + 1) * 100, 3_000);
	});

	// An 'error' event with no listener would crash the process.
	client.on('error', (err) => log.warn({ err }, 'redis error'));
	client.on('ready', () => log.debug('redis ready'));
	client.on('end', () => log.debug('redis connection closed'));

	const stopClient = async (signal?: AbortSignal) => {
		if (!client.isOpen) return;
		if (!ready) return client.destroy();

		// Graceful: let in-flight commands finish. If the lifecycle gives up, cut the socket.
		const force = () => client.destroy();
		signal?.addEventListener('abort', force, { once: true });
		try {
			await client.close();
		} catch (err) {
			if (!signal?.aborted) throw err;
		} finally {
			signal?.removeEventListener('abort', force);
		}
	};

	const resource: Resource = {
		name: 'redis',
		async start() {
			await client.connect();
			ready = true;
		},
		async check(signal) {
			await client.withAbortSignal(signal).ping();
		},
		stop: stopClient,
	};

	return {
		client,
		resource,
		/** `await using redis = createRedis(...)` closes the connection on scope exit. */
		async [Symbol.asyncDispose]() {
			await stopClient();
		},
	};
}
