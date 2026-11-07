import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { STATUS_BY_CODE, isAppError, type ErrorCode } from '../errors.js';
import { currentLogger } from '../request-context.js';
import { createLogger } from '../logger.js';

interface ErrorBody {
	code: ErrorCode;
	message: string;
	details?: unknown;
}

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

function send(res: ServerResponse, statusCode: number, body: ErrorBody): void {
	res.statusCode = statusCode;
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(body));
}

/**
 * THE edge: the only place that knows about HTTP status codes. Catches every
 * unhandled exception and converts it to a consistent `ErrorBody` response.
 * Business code throws or returns `AppError`; infra throws `Error`; Zod throws
 * `ZodError`; NestJS internals throw `HttpException` — all handled here.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
	private readonly fallbackLog = createLogger({ level: 'info', name: 'rnd' });

	// fallow-ignore-next-line complexity
	catch(exception: unknown, host: ArgumentsHost): void {
		const ctx = host.switchToHttp();
		const res = ctx.getResponse<ServerResponse>();
		const req = ctx.getRequest<IncomingMessage>();
		const log = currentLogger(this.fallbackLog);

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
			return send(res, 400, body);
		}

		// AppError → HTTP status from STATUS_BY_CODE
		if (isAppError(exception)) {
			const status = STATUS_BY_CODE[exception.code];

			if (status >= 500) {
				log.error({ err: exception }, 'request failed');
				const code: ErrorCode = status === 503 ? 'unavailable' : 'internal';
				const message = status === 503 ? 'Service unavailable' : 'Internal server error';
				return send(res, status, { code, message });
			}

			if (exception.code === 'rate_limited') {
				const details = exception.details as { retryAfterSeconds?: number } | undefined;
				if (details?.retryAfterSeconds !== undefined) {
					res.setHeader('retry-after', details.retryAfterSeconds);
				}
			}

			return send(res, status, {
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
				return send(res, status, { code: 'internal', message: 'Internal server error' });
			}

			if (status === 404) {
				return send(res, 404, {
					code: 'not_found',
					message: `Route ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'} not found`,
				});
			}

			const response = exception.getResponse();
			const message =
				typeof response === 'string'
					? response
					: (response as Record<string, unknown>)['message'] != null
						? String((response as Record<string, unknown>)['message'])
						: exception.message;
			return send(res, status, { code: codeForStatus(status), message });
		}

		// Unknown error → 500 (details stay in logs, never exposed to callers)
		log.error({ err: exception }, 'unhandled exception');
		send(res, 500, { code: 'internal', message: 'Internal server error' });
	}
}
