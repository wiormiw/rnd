import { hasZodFastifySchemaValidationErrors } from '@fastify/type-provider-zod';
import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { isAppError, type ErrorCode } from '../lib/errors.js';

/**
 * THE edge: the only place that knows about HTTP status codes. Everything
 * below it throws or returns domain errors (`AppError`) and never mentions a
 * status. Every error response has the shape of `errorResponse` in lib/schemas.
 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
	invalid: 422,
	unauthorized: 401,
	forbidden: 403,
	not_found: 404,
	conflict: 409,
	rate_limited: 429,
	unavailable: 503,
	internal: 500,
};

/** Fastify/Node errors that carry their own 4xx status (bad JSON, body too large...). */
function codeForStatus(status: number): ErrorCode {
	switch (status) {
		case 401:
			return 'unauthorized';
		case 403:
			return 'forbidden';
		case 404:
			return 'not_found';
		case 409:
			return 'conflict';
		case 429:
			return 'rate_limited';
		default:
			return 'invalid';
	}
}

interface ErrorBody {
	code: ErrorCode;
	message: string;
	details?: unknown;
}

export default fp(
	async function errorHandlerPlugin(app) {
		app.setNotFoundHandler((request, reply) => {
			const body: ErrorBody = {
				code: 'not_found',
				message: `Route ${request.method} ${request.url} not found`,
			};
			return reply.code(404).send(body);
		});

		app.setErrorHandler<FastifyError>((error, request, reply) => {
			if (hasZodFastifySchemaValidationErrors(error)) {
				const body: ErrorBody = {
					code: 'invalid',
					message: 'Request validation failed',
					details: error.validation.map(({ instancePath, message }) => ({
						path: instancePath,
						message,
					})),
				};
				return reply.code(400).send(body);
			}

			const known = isAppError(error);
			const status = known ? STATUS_BY_CODE[error.code] : (error.statusCode ?? 500);

			if (status >= 500) {
				// Details stay in the logs. The caller only learns that it failed.
				request.log.error({ err: error }, 'request failed');
				const code: ErrorCode = status === 503 ? 'unavailable' : 'internal';
				const message = status === 503 ? 'Service unavailable' : 'Internal server error';
				return reply.code(status).send({ code, message } satisfies ErrorBody);
			}

			if (known && error.code === 'rate_limited') {
				const details = error.details as { retryAfterSeconds?: number } | undefined;
				if (details?.retryAfterSeconds) reply.header('retry-after', details.retryAfterSeconds);
			}

			const body: ErrorBody = known
				? { code: error.code, message: error.message, details: error.details }
				: { code: codeForStatus(status), message: error.message };
			return reply.code(status).send(body);
		});
	},
	{ name: 'error-handler' },
);
