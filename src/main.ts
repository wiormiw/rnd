import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NodeAdapter } from '@nestjs/platform-node';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(AppModule, new NodeAdapter());
	app.enableShutdownHooks();

	const config = app.get(ConfigService);

	const corsOrigin = config.get('CORS_ORIGIN');
	if (corsOrigin) {
		app.enableCors({ origin: corsOrigin });
	}

	await app.listen(config.get('PORT'), config.get('HOST'));

	// Keep-alive must exceed cloud LB idle timeout (e.g. AWS ALB = 60 s) to prevent 502s.
	const keepAliveMs = config.get('KEEP_ALIVE_TIMEOUT_MS');
	const server = app.getHttpServer() as import('node:http').Server;
	server.keepAliveTimeout = keepAliveMs;
	server.headersTimeout = keepAliveMs + 1000;

	// Hard outer deadline so a stalled shutdown hook cannot block a rolling deploy.
	const shutdownMs = config.get('SHUTDOWN_TIMEOUT_MS');
	const forceExit = (): void => {
		setTimeout(() => process.exit(1), shutdownMs).unref();
	};
	process.once('SIGTERM', forceExit);
	process.once('SIGINT', forceExit);
}

void bootstrap();
