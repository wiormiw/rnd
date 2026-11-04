import { describe, expect, it } from 'vitest';
import { createSilentLogger } from '../lib/logger.js';
import { currentLogger, requestContext, type RequestContext } from '../lib/request-context.js';

const logger = createSilentLogger();

function context(requestId: string): RequestContext {
	return { requestId, logger, signal: new AbortController().signal, startedAt: 0 };
}

describe('requestContext', () => {
	it('is empty outside a request', () => {
		expect(requestContext.get()).toBeUndefined();
	});

	it('is visible across awaits and timers inside run()', async () => {
		await requestContext.run(context('r1'), async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			expect(requestContext.get()?.requestId).toBe('r1');
		});
		expect(requestContext.get()).toBeUndefined();
	});

	it('isolates concurrent runs', async () => {
		const seen = await Promise.all(
			['a', 'b', 'c'].map((id, i) =>
				requestContext.run(context(id), async () => {
					await new Promise((resolve) => setTimeout(resolve, 10 - i * 3));
					return requestContext.get()?.requestId;
				}),
			),
		);
		expect(seen).toEqual(['a', 'b', 'c']);
	});

	it('currentLogger prefers the request logger and falls back outside a request', () => {
		const fallback = createSilentLogger();
		expect(currentLogger(fallback)).toBe(fallback);
		requestContext.run(context('r'), () => {
			expect(currentLogger(fallback)).toBe(logger);
		});
	});
});
