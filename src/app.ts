import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import {
	serializerCompiler,
	validatorCompiler,
	type ZodTypeProvider,
} from '@fastify/type-provider-zod';
import Fastify from 'fastify';
import type { Infrastructure } from './infrastructure/index.js';
import type { Env } from './lib/config.js';
import type { Logger } from './lib/logger.js';
import type { Services } from './modules/index.js';
import { memoRoutes } from './modules/memos/routes.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import infrastructurePlugin from './plugins/infrastructure.js';
import rateLimitPlugin, { type TokenBucket } from './plugins/rate-limit/index.js';
import requestContextPlugin from './plugins/request-context.js';
import servicesPlugin from './plugins/services.js';
import { healthRoutes } from './routes/health.js';

export interface AppDependencies {
	logger: Logger;
	infra: Infrastructure;
	/** Built by the caller (see index.ts), so the dependency graph is visible at the entry point. */
	services: Services;
	/** Spends tokens for the rate limiter. Redis-backed in production, a fake in tests. */
	rateLimitBucket: TokenBucket;
}

/**
 * The returned app is `AsyncDisposable`, so `await using app = buildApp(...)`
 * closes it (and, through the infrastructure plugin, the lifecycle) on scope exit.
 */
export function buildApp(
	config: Env,
	{ logger, infra, services, rateLimitBucket }: AppDependencies,
) {
	const app = Fastify({
		loggerInstance: logger,
		genReqId: () => randomUUID(),
		trustProxy: config.TRUST_PROXY,
		requestTimeout: config.REQUEST_TIMEOUT_MS,
		keepAliveTimeout: config.KEEP_ALIVE_TIMEOUT_MS,
		// On close, drop idle keep-alive sockets so shutdown is not held up by them.
		forceCloseConnections: 'idle',
	}).withTypeProvider<ZodTypeProvider>();

	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

	// Order matters: context first so everything below runs inside it, and the
	// error handler before the routes so they inherit it.
	app.register(requestContextPlugin);
	app.register(errorHandlerPlugin);
	app.register(helmet);
	app.register(cors, { origin: config.CORS_ORIGIN ?? false });
	// After cors/helmet so a 429 still carries their headers.
	app.register(rateLimitPlugin, {
		enabled: config.RATE_LIMIT_ENABLED,
		bucket: rateLimitBucket,
		defaults: {
			capacity: config.RATE_LIMIT_CAPACITY,
			refillPerSecond: config.RATE_LIMIT_REFILL_PER_SECOND,
		},
		timeoutMs: config.RATE_LIMIT_TIMEOUT_MS,
		failOpen: config.RATE_LIMIT_FAIL_OPEN,
	});
	app.register(infrastructurePlugin, { infra });
	app.register(servicesPlugin, { services });

	app.register(healthRoutes);
	app.register(memoRoutes, { prefix: '/memos' });

	return app;
}
