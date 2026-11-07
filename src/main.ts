import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NodeAdapter } from '@nestjs/platform-node';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(AppModule, new NodeAdapter());
	app.enableShutdownHooks();
	const config = app.get(ConfigService);
	await app.listen(config.get('PORT'), config.get('HOST'));
}

void bootstrap();
