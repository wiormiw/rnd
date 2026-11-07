import { Module } from '@nestjs/common';
import { RedisService, REDIS_TOKEN, TOKEN_BUCKET_TOKEN } from './redis.service.js';

@Module({
	providers: [
		RedisService,
		{
			provide: REDIS_TOKEN,
			useFactory: (svc: RedisService) => svc.client,
			inject: [RedisService],
		},
		{
			provide: TOKEN_BUCKET_TOKEN,
			useFactory: (svc: RedisService) => svc.bucket,
			inject: [RedisService],
		},
	],
	exports: [REDIS_TOKEN, TOKEN_BUCKET_TOKEN],
})
export class RedisModule {}
