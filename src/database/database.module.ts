import { Module } from '@nestjs/common';
import { DatabaseService, DATABASE_TOKEN } from './database.service.js';

@Module({
	providers: [
		DatabaseService,
		{
			provide: DATABASE_TOKEN,
			useFactory: (svc: DatabaseService) => svc.db,
			inject: [DatabaseService],
		},
	],
	exports: [DATABASE_TOKEN],
})
export class DatabaseModule {}
