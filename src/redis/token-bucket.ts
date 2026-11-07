import { createHash } from 'node:crypto';
import type { RedisClient } from './client.js';

/**
 * Token bucket, evaluated inside Redis so the read-refill-spend-write cycle is
 * atomic across any number of app instances.
 *
 * - Time comes from Redis (`TIME`), so app clocks can drift without effect.
 * - State is one hash per bucket (`tokens`, `ts`). A bucket that is full again
 *   is indistinguishable from a new one, so the key expires when it would be full.
 * - A denied call still saves the refill it computed: no credit is lost or doubled.
 *
 * KEYS[1]  bucket key
 * ARGV[1]  capacity (max tokens)         ARGV[2]  refill rate (tokens per second)
 * ARGV[3]  cost of this request (tokens)
 *
 * Returns { allowed (0|1), remaining (whole tokens), retry_after_ms, full_in_ms }.
 */
export const TOKEN_BUCKET_LUA = `
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * rate / 1000)

local allowed = 0
local retry_after_ms = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_after_ms = math.ceil((cost - tokens) * 1000 / rate)
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)

local full_in_ms = math.ceil((capacity - tokens) * 1000 / rate)
redis.call('PEXPIRE', KEYS[1], math.max(full_in_ms, 1000))

return { allowed, math.floor(tokens), retry_after_ms, full_in_ms }
`;

/** Redis identifies cached scripts by SHA1, so only this hash is sent per request. */
export const TOKEN_BUCKET_SHA = createHash('sha1').update(TOKEN_BUCKET_LUA).digest('hex');

export interface BucketPolicy {
	capacity: number;
	refillPerSecond: number;
	cost: number;
}

export interface BucketResult {
	allowed: boolean;
	/** Whole tokens left after this call. */
	remaining: number;
	/** When denied: how long until `cost` tokens are available. */
	retryAfterMs: number;
	/** How long until the bucket is full again. */
	fullInMs: number;
}

/** Spend `policy.cost` tokens from the bucket at `key`. */
export type TokenBucket = (
	key: string,
	policy: BucketPolicy,
	signal: AbortSignal,
) => Promise<BucketResult>;

function isNoScript(err: unknown): boolean {
	return err instanceof Error && err.message.startsWith('NOSCRIPT');
}

function parseReply(reply: unknown): BucketResult {
	if (!Array.isArray(reply) || reply.length !== 4 || !reply.every((n) => typeof n === 'number')) {
		throw new Error(`unexpected token bucket reply: ${JSON.stringify(reply)}`);
	}
	const [allowed, remaining, retryAfterMs, fullInMs] = reply as [number, number, number, number];
	return { allowed: allowed === 1, remaining, retryAfterMs, fullInMs };
}

/**
 * Run the bucket on Redis with EVALSHA. Redis only knows the script after it has
 * been loaded once; on `NOSCRIPT` (first call, restart, `SCRIPT FLUSH`, failover)
 * fall back to EVAL, which runs it and caches it for the next EVALSHA.
 */
export function createRedisTokenBucket(redis: RedisClient): TokenBucket {
	return async (key, policy, signal) => {
		const command = redis.withAbortSignal(signal);
		const options = {
			keys: [key],
			arguments: [String(policy.capacity), String(policy.refillPerSecond), String(policy.cost)],
		};

		try {
			return parseReply(await command.evalSha(TOKEN_BUCKET_SHA, options));
		} catch (err) {
			if (!isNoScript(err)) throw err;
			return parseReply(await command.eval(TOKEN_BUCKET_LUA, options));
		}
	};
}
