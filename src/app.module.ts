import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';

@Module({
	imports: [ConfigModule, DatabaseModule, RedisModule],
	providers: [
		{ provide: APP_FILTER, useClass: AllExceptionsFilter },
		{ provide: APP_GUARD, useClass: RateLimitGuard },
		{ provide: APP_PIPE, useClass: ZodValidationPipe },
	],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer): void {
		consumer.apply(RequestContextMiddleware).forRoutes('*');
	}
}
