import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
	imports: [ConfigModule, DatabaseModule, RedisModule],
	controllers: [],
	providers: [],
})
export class AppModule {}
