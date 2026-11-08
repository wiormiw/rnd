import * as z from 'zod';
import { intEnv } from '../common/env.js';
import { dbEnvSchema } from '../database/env.js';
import { redisEnvSchema } from '../redis/env.js';

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	HOST: z.string().default('0.0.0.0'),
	PORT: z.coerce.number().int().min(1).max(65535).default(3000),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
	// Optional, comma separated list of allowed origins. Unset = CORS disabled.
	CORS_ORIGIN: z
		.string()
		.transform((value) => value.split(',').map((origin) => origin.trim()))
		.optional(),

	// HTTP server timeouts.
	KEEP_ALIVE_TIMEOUT_MS: intEnv().default(72_000),
	/** Hard deadline for the whole graceful shutdown. Keep it above LIFECYCLE_STOP_TIMEOUT_MS. */
	SHUTDOWN_TIMEOUT_MS: intEnv(1).default(15_000),

	// Infrastructure lifecycle timeouts (per resource).
	LIFECYCLE_START_TIMEOUT_MS: intEnv(1).default(15_000),
	LIFECYCLE_STOP_TIMEOUT_MS: intEnv(1).default(10_000),

	/** Trust X-Forwarded-For. Enable ONLY behind a proxy you control, or clients can spoof their IP. */
	TRUST_PROXY: z.stringbool().default(false),

	// Rate limiting (token bucket per client IP, state in Redis).
	RATE_LIMIT_ENABLED: z.stringbool().default(true),
	/** Bucket size: the burst a client may spend at once. */
	RATE_LIMIT_CAPACITY: z.coerce.number().int().min(1).default(60),
	/** Tokens added per second: the sustained rate. May be fractional (0.5 = one per 2s). */
	RATE_LIMIT_REFILL_PER_SECOND: z.coerce.number().positive().default(1),
	/** Give up on Redis after this long. */
	RATE_LIMIT_TIMEOUT_MS: intEnv(1).default(200),
	/** true: let requests through when Redis fails. false: answer 503. */
	RATE_LIMIT_FAIL_OPEN: z.stringbool().default(true),

	...dbEnvSchema.shape,
	...redisEnvSchema.shape,
});

export type Env = z.infer<typeof envSchema>;

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
	let current = root;
	for (const key of path) {
		if (typeof current !== 'object' || current === null) return undefined;
		current = (current as Record<PropertyKey, unknown>)[key];
	}
	return current;
}

/**
 * Validate raw environment variables against a schema.
 *
 * Unset and blank values are treated as absent, so `.default()` and `.optional()`
 * apply to them. All problems are reported at once, one line per variable.
 */
function loadEnv<Schema extends z.ZodType>(
	schema: Schema,
	raw: Record<string, string | undefined>,
): z.infer<Schema> {
	const present = Object.fromEntries(
		Object.entries(raw).filter(([, value]) => value !== undefined && value.trim() !== ''),
	);
	const parsed = z.safeParse(schema, present);
	if (parsed.success) return parsed.data;

	const problems = new Map<string, string>();
	for (const issue of parsed.error.issues) {
		const name = issue.path.join('.') || 'root';
		// Zod does not attach `input` to issues by default, so look the value up instead.
		const absent = issue.code === 'invalid_type' && valueAt(present, issue.path) === undefined;

		if (!problems.has(name)) {
			problems.set(name, absent ? 'is required' : issue.message);
		}
	}

	const lines = [...problems].map(([name, message]) => `${name}: ${message}`).join('\n');
	throw new Error(`Invalid environment variables configuration:\n${lines}`);
}

export function loadConfig(raw: Record<string, string | undefined> = process.env): Env {
	return loadEnv(envSchema, raw);
}
