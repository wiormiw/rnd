import { Injectable, Inject, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TOKEN_BUCKET_TOKEN } from '../../redis/redis.service.js';
import { ConfigService } from '../../config/config.service.js';
import { errors } from '../errors.js';
import { currentLogger } from '../request-context.js';
import { createLogger } from '../logger.js';
import type { TokenBucket } from '../../redis/token-bucket.js';
import type { BucketPolicy } from '../../redis/token-bucket.js';

export const RATE_LIMIT_METADATA = 'rateLimit';

/**
 * Decorate a controller or handler to opt out of rate limiting (`false`) or
 * give it its own bucket policy (overrides are merged onto the global defaults).
 */
export const RateLimit = (policy: false | { capacity?: number; cost?: number }): MethodDecorator &
	ClassDecorator => SetMetadata(RATE_LIMIT_METADATA, policy);

type RouteMeta = false | { capacity?: number; cost?: number };

const seconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

/**
 * Per-client-IP rate limiting. Sets `RateLimit-*` headers on every counted
 * response and throws a business `rate_limited` error when the bucket is empty:
 * the 429 and `Retry-After` are produced by `AllExceptionsFilter`.
 *
 * Routes opt out with `@RateLimit(false)`. Routes with their own bucket policy
 * set `@RateLimit({ capacity, cost })` — they get a separate bucket so a chatty
 * endpoint cannot drain the global allowance.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
	private readonly fallbackLog = createLogger({ level: 'info', name: 'rnd' });

	constructor(
		@Inject(TOKEN_BUCKET_TOKEN) private readonly bucket: TokenBucket,
		private readonly config: ConfigService,
		private readonly reflector: Reflector,
	) {}

	// fallow-ignore-next-line complexity
	async canActivate(context: ExecutionContext): Promise<boolean> {
		const enabled = this.config.get('RATE_LIMIT_ENABLED');
		if (!enabled) return true;

		const routeMeta = this.reflector.getAllAndOverride<RouteMeta | undefined>(
			RATE_LIMIT_METADATA,
			[context.getHandler(), context.getClass()],
		);
		if (routeMeta === false) return true;

		const req = context.switchToHttp().getRequest<IncomingMessage>();
		const res = context.switchToHttp().getResponse<ServerResponse>();
		const log = currentLogger(this.fallbackLog);

		const capacity = this.config.get('RATE_LIMIT_CAPACITY');
		const refillPerSecond = this.config.get('RATE_LIMIT_REFILL_PER_SECOND');
		const timeoutMs = this.config.get('RATE_LIMIT_TIMEOUT_MS');
		const failOpen = this.config.get('RATE_LIMIT_FAIL_OPEN');
		const trustProxy = this.config.get('TRUST_PROXY');

		const defaults: Pick<BucketPolicy, 'capacity' | 'refillPerSecond'> = {
			capacity,
			refillPerSecond,
		};

		const policy: BucketPolicy = { ...defaults, cost: 1, ...routeMeta };

		// A route with its own policy gets its own bucket so a chatty endpoint
		// cannot drain the allowance of the rest of the API.
		const scope = routeMeta
			? `${req.method ?? 'UNKNOWN'}:${req.url?.split('?')[0] ?? '/'}`
			: 'global';

		const ip = trustProxy
			? (req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ??
				req.socket.remoteAddress ??
				'unknown')
			: (req.socket.remoteAddress ?? 'unknown');

		const key = `rl:${scope}:${ip}`;

		let result;
		try {
			result = await this.bucket(key, policy, AbortSignal.timeout(timeoutMs));
		} catch (err) {
			log.warn({ err }, 'rate limiter unavailable');
			if (failOpen) return true;
			throw errors.unavailable('rate limiter', err);
		}

		res.setHeader('ratelimit-limit', policy.capacity);
		res.setHeader('ratelimit-remaining', result.remaining);
		res.setHeader('ratelimit-reset', seconds(result.fullInMs));

		if (!result.allowed) {
			log.info({ key }, 'rate limit exceeded');
			throw errors.rateLimited(result.retryAfterMs);
		}

		return true;
	}
}
