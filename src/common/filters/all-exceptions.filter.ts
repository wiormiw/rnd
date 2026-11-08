import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { STATUS_BY_CODE, isAppError, type ErrorCode, type RateLimitedDetails } from '../errors.js';
import { sendJson } from '../http.js';
import type { ErrorBody } from '../schemas.js';
import { currentLogger } from '../request-context.js';

// fallow-ignore-next-line complexity
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

/**
 * THE edge: the only place that knows about HTTP status codes. Catches every
 * unhandled exception and converts it to a consistent `ErrorBody` response.
 * Business code throws or returns `AppError`; infra throws `Error`; Zod throws
 * `ZodError`; NestJS internals throw `HttpException` — all handled here.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
	// fallow-ignore-next-line complexity
	catch(exception: unknown, host: ArgumentsHost): void {
		const ctx = host.switchToHttp();
		const res = ctx.getResponse<ServerResponse>();
		const req = ctx.getRequest<IncomingMessage>();
		const log = currentLogger();

		// ZodError → 400 with field-level error details
		if (exception instanceof ZodError) {
			const body: ErrorBody = {
				code: 'invalid',
				message: 'Request validation failed',
				details: exception.issues.map((issue) => ({
					path: issue.path.join('.'),
					message: issue.message,
				})),
			};
			return sendJson(res, 400, body);
		}

		// AppError → HTTP status from STATUS_BY_CODE
		if (isAppError(exception)) {
			const status = STATUS_BY_CODE[exception.code];

			if (status >= 500) {
				log.error({ err: exception }, 'request failed');
				const code: ErrorCode = status === 503 ? 'unavailable' : 'internal';
				const message = status === 503 ? 'Service unavailable' : 'Internal server error';
				return sendJson(res, status, { code, message });
			}

			if (exception.code === 'rate_limited') {
				const details = exception.details as RateLimitedDetails | undefined;
				if (details) {
					res.setHeader('retry-after', details.retryAfterSeconds);
				}
			}

			return sendJson(res, status, {
				code: exception.code,
				message: exception.message,
				details: exception.details,
			});
		}

		// NestJS HttpException (NotFoundException → 404, BadRequestException → 400, etc.)
		if (exception instanceof HttpException) {
			const status = exception.getStatus();

			if (status >= 500) {
				log.error({ err: exception }, 'request failed');
				return sendJson(res, status, { code: 'internal', message: 'Internal server error' });
			}

			if (status === 404) {
				// `url` is relative to the /api/v1 mount; `originalUrl` is what the client sent.
				const url = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url;
				return sendJson(res, 404, {
					code: 'not_found',
					message: `Route ${req.method ?? 'UNKNOWN'} ${url ?? '/'} not found`,
				});
			}

			const response = exception.getResponse();
			const message =
				typeof response === 'string'
					? response
					: (response as Record<string, unknown>)['message'] != null
						? String((response as Record<string, unknown>)['message'])
						: exception.message;
			return sendJson(res, status, { code: codeForStatus(status), message });
		}

		// Unknown error → 500 (details stay in logs, never exposed to callers)
		log.error({ err: exception }, 'unhandled exception');
		sendJson(res, 500, { code: 'internal', message: 'Internal server error' });
	}
}
