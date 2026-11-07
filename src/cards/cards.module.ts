import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CardsController } from './cards.controller.js';
import { CardsRepository } from './cards.repository.js';
import { CardsService } from './cards.service.js';

@Module({
	imports: [DatabaseModule],
	controllers: [CardsController],
	providers: [CardsRepository, CardsService],
})
export class CardsModule {}
