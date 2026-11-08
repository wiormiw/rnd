import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { requestContext, type RequestContext } from '../request-context.js';
import { defaultLogger } from '../logger.js';

/**
 * Runs the rest of the request lifecycle inside an AsyncLocalStorage store so
 * any code below can read the request id, logger, abort signal and start time
 * without needing them threaded through as parameters.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
	use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
		const requestId = randomUUID();
		const logger = defaultLogger.child({ requestId });

		res.setHeader('x-request-id', requestId);

		// Wire an AbortSignal so downstream code can cancel work when the
		// client disconnects so cancellable work stops.
		const controller = new AbortController();
		req.on('close', () => {
			controller.abort();
		});

		const ctx: RequestContext = {
			requestId,
			logger,
			signal: controller.signal,
			startedAt: Date.now(),
		};
		requestContext.run(ctx, next);
	}
}
