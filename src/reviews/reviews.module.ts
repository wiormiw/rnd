import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsRepository } from './reviews.repository.js';
import { ReviewsService } from './reviews.service.js';

@Module({
	imports: [DatabaseModule],
	controllers: [ReviewsController],
	providers: [ReviewsRepository, ReviewsService],
})
export class ReviewsModule {}
