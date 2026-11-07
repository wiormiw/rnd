import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthModule } from './health/health.module.js';
import { MemosModule } from './memos/memos.module.js';
import { CurriculumModule } from './curriculum/curriculum.module.js';
import { CardsModule } from './cards/cards.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { ActionItemsModule } from './action-items/action-items.module.js';
import { ScheduleModule } from './schedule/schedule.module.js';
import { ClockModule } from './common/clock.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware.js';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';

@Module({
	imports: [
		ConfigModule,
		DatabaseModule,
		RedisModule,
		HealthModule,
		MemosModule,
		CurriculumModule,
		CardsModule,
		ClockModule,
		ReviewsModule,
		ActionItemsModule,
		ScheduleModule,
	],
	providers: [
		{ provide: APP_FILTER, useClass: AllExceptionsFilter },
		{ provide: APP_GUARD, useClass: RateLimitGuard },
	],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer): void {
		consumer.apply(SecurityHeadersMiddleware, RequestContextMiddleware).forRoutes('{*path}');
	}
}
