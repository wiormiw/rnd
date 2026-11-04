import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { RedisClient } from '../infrastructure/cache/client.js';
import {
	createRedisTokenBucket,
	TOKEN_BUCKET_LUA,
	TOKEN_BUCKET_SHA,
	type BucketPolicy,
} from '../plugins/rate-limit/token-bucket.js';

/**
 * The script is run by a real Lua 5.1 interpreter (the version Redis embeds)
 * against a stub of `redis.call` that keeps hashes in memory and a clock we
 * control. That tests the algorithm; the Redis integration test (opt-in, see
 * redis.integration.test.ts) tests Redis itself.
 */
const lua = ['lua5.1', 'luajit', 'lua'].find(
	(bin) => spawnSync(bin, ['-v'], { encoding: 'utf8' }).status === 0,
);

interface Step {
	at: number;
	capacity: number;
	rate: number;
	cost?: number;
}

interface Outcome {
	allowed: boolean;
	remaining: number;
	retryAfterMs: number;
	fullInMs: number;
	ttlMs: number;
}

function run(steps: Step[]): Outcome[] {
	const program = `
local SCRIPT = [==[${TOKEN_BUCKET_LUA}]==]
local hashes, ttl, clock = {}, {}, 0

-- Mimics what Redis hands to Lua: hash fields come back as strings, missing ones as false.
redis = {
  call = function(cmd, ...)
    local a = { ... }
    if cmd == 'TIME' then
      return { tostring(math.floor(clock / 1000)), tostring((clock % 1000) * 1000) }
    elseif cmd == 'HMGET' then
      local h = hashes[a[1]]
      if not h then return { false, false } end
      return { h[a[2]] or false, h[a[3]] or false }
    elseif cmd == 'HSET' then
      hashes[a[1]] = hashes[a[1]] or {}
      hashes[a[1]][a[2]] = tostring(a[3])
      hashes[a[1]][a[4]] = tostring(a[5])
      return 2
    elseif cmd == 'PEXPIRE' then
      ttl[a[1]] = a[2]
      return 1
    end
    error('unexpected command ' .. cmd)
  end
}

local fn = assert(loadstring(SCRIPT))
local steps = {
${steps.map((s) => `  { ${s.at}, ${s.capacity}, ${s.rate}, ${s.cost ?? 1} },`).join('\n')}
}
for _, s in ipairs(steps) do
  clock = s[1]
  KEYS = { 'bucket' }
  ARGV = { tostring(s[2]), tostring(s[3]), tostring(s[4]) }
  local r = fn()
  print(table.concat({ r[1], r[2], r[3], r[4], ttl['bucket'] }, ','))
end
`;
	const result = spawnSync(lua!, ['-'], { input: program, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`lua failed: ${result.stderr}\n${result.stdout}`);

	return result.stdout
		.trim()
		.split('\n')
		.map((line) => {
			const [allowed, remaining, retryAfterMs, fullInMs, ttlMs] = line.split(',').map(Number) as [
				number,
				number,
				number,
				number,
				number,
			];
			return { allowed: allowed === 1, remaining, retryAfterMs, fullInMs, ttlMs };
		});
}

describe.skipIf(!lua)('token bucket Lua script', () => {
	it('starts full, spends one token per call, then denies', () => {
		const out = run([0, 0, 0, 0].map((at) => ({ at, capacity: 3, rate: 1 })));

		expect(out.map((o) => o.allowed)).toEqual([true, true, true, false]);
		expect(out.map((o) => o.remaining)).toEqual([2, 1, 0, 0]);
	});

	it('says how long until the next token when denied', () => {
		const out = run([
			{ at: 0, capacity: 1, rate: 1 },
			{ at: 0, capacity: 1, rate: 1 },
			{ at: 400, capacity: 1, rate: 1 },
		]);

		expect(out[1]).toMatchObject({ allowed: false, retryAfterMs: 1000 });
		expect(out[2]).toMatchObject({ allowed: false, retryAfterMs: 600 });
	});

	it('refills over time at the configured rate', () => {
		const out = run([
			{ at: 0, capacity: 2, rate: 1 },
			{ at: 0, capacity: 2, rate: 1 },
			{ at: 0, capacity: 2, rate: 1 },
			{ at: 1000, capacity: 2, rate: 1 },
			{ at: 1000, capacity: 2, rate: 1 },
		]);

		expect(out.map((o) => o.allowed)).toEqual([true, true, false, true, false]);
	});

	it('supports fractional rates', () => {
		const out = run([
			{ at: 0, capacity: 1, rate: 0.5 },
			{ at: 0, capacity: 1, rate: 0.5 },
			{ at: 1999, capacity: 1, rate: 0.5 },
			{ at: 2000, capacity: 1, rate: 0.5 },
		]);

		expect(out[1]?.retryAfterMs).toBe(2000);
		expect(out.map((o) => o.allowed)).toEqual([true, false, false, true]);
	});

	it('never refills past capacity', () => {
		const out = run([
			{ at: 0, capacity: 3, rate: 10 },
			{ at: 3_600_000, capacity: 3, rate: 10 },
		]);

		expect(out[1]).toMatchObject({ allowed: true, remaining: 2 });
	});

	it('does not lose or double refill across denied calls', () => {
		// Hammer a drained bucket for a second, then exactly one token must be available.
		const hammer = Array.from({ length: 10 }, (_, i) => ({ at: i * 100, capacity: 1, rate: 1 }));
		const out = run([
			...hammer,
			{ at: 1000, capacity: 1, rate: 1 },
			{ at: 1000, capacity: 1, rate: 1 },
		]);

		expect(out.slice(1, 10).every((o) => !o.allowed)).toBe(true);
		expect(out[10]?.allowed).toBe(true);
		expect(out[11]?.allowed).toBe(false);
	});

	it('charges the cost of a request and denies when it does not fit', () => {
		const out = run([
			{ at: 0, capacity: 5, rate: 1, cost: 3 },
			{ at: 0, capacity: 5, rate: 1, cost: 3 },
		]);

		expect(out[0]).toMatchObject({ allowed: true, remaining: 2 });
		expect(out[1]).toMatchObject({ allowed: false, remaining: 2, retryAfterMs: 1000 });
	});

	it('ignores a clock that moves backwards instead of minting tokens', () => {
		const out = run([
			{ at: 10_000, capacity: 1, rate: 1 },
			{ at: 5_000, capacity: 1, rate: 1 },
		]);

		expect(out[1]?.allowed).toBe(false);
	});

	it('expires the key when the bucket would be full again, and never below 1s', () => {
		const out = run([
			{ at: 0, capacity: 10, rate: 2 },
			{ at: 0, capacity: 10, rate: 2 },
		]);

		// 2 tokens spent at 2/s -> 1000ms to refill.
		expect(out[1]).toMatchObject({ fullInMs: 1000, ttlMs: 1000 });

		const idle = run([{ at: 0, capacity: 10, rate: 1000 }]);
		expect(idle[0]?.ttlMs).toBe(1000);
	});
});

describe('createRedisTokenBucket', () => {
	const policy: BucketPolicy = { capacity: 10, refillPerSecond: 2, cost: 1 };
	const signal = new AbortController().signal;

	function fakeRedis(handlers: { evalSha?: () => unknown; evalScript?: () => unknown }) {
		const log: string[] = [];
		let usedSignal: AbortSignal | undefined;
		const client = {
			withAbortSignal(s: AbortSignal) {
				usedSignal = s;
				return {
					async evalSha(sha: string, options: unknown) {
						log.push(`EVALSHA ${sha} ${JSON.stringify(options)}`);
						return handlers.evalSha?.();
					},
					async eval(script: string) {
						log.push(`EVAL ${script === TOKEN_BUCKET_LUA ? 'script' : '???'}`);
						return handlers.evalScript?.();
					},
				};
			},
		};
		return { redis: client as unknown as RedisClient, log, signalUsed: () => usedSignal };
	}

	it('uses EVALSHA with string arguments and parses the reply', async () => {
		const { redis, log, signalUsed } = fakeRedis({ evalSha: () => [1, 9, 0, 500] });

		const result = await createRedisTokenBucket(redis)('k', policy, signal);

		expect(result).toEqual({ allowed: true, remaining: 9, retryAfterMs: 0, fullInMs: 500 });
		expect(log).toEqual([`EVALSHA ${TOKEN_BUCKET_SHA} {"keys":["k"],"arguments":["10","2","1"]}`]);
		expect(signalUsed()).toBe(signal);
	});

	it('falls back to EVAL when Redis has not cached the script (NOSCRIPT)', async () => {
		const { redis, log } = fakeRedis({
			evalSha: () => {
				throw new Error('NOSCRIPT No matching script. Please use EVAL.');
			},
			evalScript: () => [0, 0, 1500, 9000],
		});

		const result = await createRedisTokenBucket(redis)('k', policy, signal);

		expect(result).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1500, fullInMs: 9000 });
		expect(log.map((line) => line.split(' ')[0])).toEqual(['EVALSHA', 'EVAL']);
		expect(log[1]).toBe('EVAL script');
	});

	it('does not mask other errors with a fallback', async () => {
		const { redis, log } = fakeRedis({
			evalSha: () => {
				throw new Error('ERR Error running script');
			},
		});

		await expect(createRedisTokenBucket(redis)('k', policy, signal)).rejects.toThrow('ERR Error');
		expect(log).toHaveLength(1);
	});

	it('rejects a malformed reply', async () => {
		const { redis } = fakeRedis({ evalSha: () => ['nope'] });

		await expect(createRedisTokenBucket(redis)('k', policy, signal)).rejects.toThrow(
			'unexpected token bucket reply',
		);
	});

	it('identifies the script by the SHA1 of its source', () => {
		expect(TOKEN_BUCKET_SHA).toMatch(/^[0-9a-f]{40}$/);
	});
});
