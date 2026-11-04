import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { createInfrastructure } from './infrastructure/index.js';
import { loadConfig, type Env } from './lib/config.js';
import { createLogger } from './lib/logger.js';
import { createRepositories, createServices } from './modules/index.js';
import { createRedisTokenBucket } from './plugins/rate-limit/token-bucket.js';

let config: Env;
try {
	config = loadConfig();
} catch (err) {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
}

const logger = createLogger({ level: config.LOG_LEVEL, name: 'rnd' });
const infra = createInfrastructure(config, logger);
const services = createServices(createRepositories(infra.db), logger);
const rateLimitBucket = createRedisTokenBucket(infra.redis);
const app = buildApp(config, { logger, infra, services, rateLimitBucket });

// Aborted on shutdown, which also cancels startup if it is still in progress.
const startup = new AbortController();

// closeWithGrace force-exits after `delay` if the handler has not finished.
closeWithGrace({ delay: config.SHUTDOWN_TIMEOUT_MS }, async ({ signal, err }) => {
	if (err) {
		logger.error({ err }, 'shutting down due to error');
	} else {
		logger.info({ signal }, 'shutting down due to signal');
	}
	startup.abort(err ?? new Error(`received ${signal}`));
	// Drains requests, then the infrastructure plugin stops the lifecycle.
	await app.close();
});

try {
	await infra.lifecycle.start(startup.signal);
	await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
	// A shutdown signal interrupted startup: closeWithGrace is already cleaning up.
	if (startup.signal.aborted) {
		logger.warn({ err }, 'startup aborted');
	} else {
		logger.fatal({ err }, 'failed to start');
		await app.close().catch(() => {});
		process.exit(1);
	}
}
