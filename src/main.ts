import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NodeAdapter } from '@nestjs/platform-node';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create(AppModule, new NodeAdapter());
	app.enableShutdownHooks();
	await app.listen(3000);
}

void bootstrap();
