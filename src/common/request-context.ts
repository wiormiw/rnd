// fallow-ignore-file unused-file
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from './logger.js';

type BaseLogger = Pick<Logger, 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'>;

/** Data that belongs to one in-flight request, readable from anywhere below it. */
export interface RequestContext {
	readonly requestId: string;
	/** The request-scoped logger: every line carries the request id. */
	readonly logger: BaseLogger;
	/** Aborts when the client goes away. Pass it to anything cancellable. */
	readonly signal: AbortSignal;
	readonly startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
	run: <T>(context: RequestContext, fn: () => T): T => storage.run(context, fn),
	get: (): RequestContext | undefined => storage.getStore(),
};

/**
 * The request's logger when called inside a request, otherwise `fallback`. Lets
 * services and repositories log with the request id without receiving it as a
 * parameter.
 */
export function currentLogger<Fallback extends BaseLogger>(fallback: Fallback): BaseLogger {
	return storage.getStore()?.logger ?? fallback;
}
