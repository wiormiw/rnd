import fp from 'fastify-plugin';
import { errors } from '../../lib/errors.js';
import type { BucketPolicy, TokenBucket } from './token-bucket.js';

export type { BucketPolicy, TokenBucket } from './token-bucket.js';

declare module 'fastify' {
	interface FastifyContextConfig {
		/**
		 * `false` exempts the route. An object gives it its own bucket (separate
		 * from the global one) with these values over the defaults.
		 */
		rateLimit?: false | Partial<BucketPolicy>;
	}
}

export interface RateLimitOptions {
	enabled: boolean;
	bucket: TokenBucket;
	/** Applied to routes without their own `config.rateLimit`. */
	defaults: Pick<BucketPolicy, 'capacity' | 'refillPerSecond'>;
	/** Give up on the bucket (Redis) after this long. */
	timeoutMs: number;
	/** true: allow requests when the bucket fails. false: answer 503. */
	failOpen: boolean;
	/** First segment of every bucket key. */
	keyPrefix?: string;
}

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/**
 * Per-client-IP rate limiting. Sets the IETF `RateLimit-*` headers on every
 * response it counts, and fails with a business `rate_limited` error when the
 * bucket is empty: the 429 and `Retry-After` are produced by the error handler.
 *
 * Behind a proxy, enable Fastify's `trustProxy` or every client shares one IP.
 */
export default fp<RateLimitOptions>(
	async function rateLimitPlugin(app, options) {
		if (!options.enabled) return;
		const { bucket, defaults, timeoutMs, failOpen, keyPrefix = 'rl' } = options;

		app.addHook('onRequest', async (request, reply) => {
			const route = request.routeOptions?.config?.rateLimit;
			if (route === false) return;

			const policy: BucketPolicy = { ...defaults, cost: 1, ...route };
			// A route with its own policy gets its own bucket, so a chatty endpoint
			// cannot drain the allowance of the rest of the API.
			const scope = route
				? `${request.method}:${request.routeOptions.url ?? request.url}`
				: 'global';
			const key = `${keyPrefix}:${scope}:${request.ip}`;

			let result;
			try {
				result = await bucket(key, policy, AbortSignal.timeout(timeoutMs));
			} catch (err) {
				request.log.warn({ err }, 'rate limiter unavailable');
				if (failOpen) return;
				throw errors.unavailable('rate limiter', err);
			}

			reply.header('ratelimit-limit', policy.capacity);
			reply.header('ratelimit-remaining', result.remaining);
			reply.header('ratelimit-reset', seconds(result.fullInMs));

			if (!result.allowed) {
				request.log.info({ key }, 'rate limit exceeded');
				throw errors.rateLimited(result.retryAfterMs);
			}
		});
	},
	{ name: 'rate-limit' },
);
