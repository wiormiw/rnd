/**
 * Business errors. They describe WHAT went wrong in domain terms and know
 * nothing about HTTP: the status code mapping lives at the edge, in
 * `plugins/error-handler.ts`.
 *
 * Convention: expected failures (not found, conflict...) are returned as a
 * `Result` carrying an `AppError`; unexpected ones (a bug, a dead database) are
 * thrown and become a generic 500 at the edge.
 */
export const ERROR_CODES = [
	'invalid',
	'unauthorized',
	'forbidden',
	'not_found',
	'conflict',
	'rate_limited',
	'unavailable',
	'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorOptions {
	/** Safe to show to the caller. Never put secrets or internals here. */
	details?: unknown;
	cause?: unknown;
}

export class AppError extends Error {
	readonly code: ErrorCode;
	readonly details: unknown;

	constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'AppError';
		this.code = code;
		this.details = options.details;
	}
}

export function isAppError(value: unknown): value is AppError {
	return value instanceof AppError;
}

/** The one place business errors are created. */
export const errors = {
	invalid: (message: string, details?: unknown) => new AppError('invalid', message, { details }),

	unauthorized: (message = 'Authentication required') => new AppError('unauthorized', message),

	forbidden: (message = 'You are not allowed to do this') => new AppError('forbidden', message),

	notFound: (resource: string, id?: string) =>
		new AppError('not_found', `${resource} not found`, {
			details: id === undefined ? { resource } : { resource, id },
		}),

	conflict: (message: string, details?: unknown) => new AppError('conflict', message, { details }),

	/** The caller is over its quota. `retryAfterMs` becomes a Retry-After at the edge. */
	rateLimited: (retryAfterMs: number) =>
		new AppError('rate_limited', 'Too many requests', {
			details: { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) },
		}),

	/** A dependency is down or too slow. `service` is logged, not shown to callers. */
	unavailable: (service: string, cause?: unknown) =>
		new AppError('unavailable', `${service} is unavailable`, { cause }),

	internal: (message: string, cause?: unknown) => new AppError('internal', message, { cause }),
} as const;
