import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { ActionItemsController } from './action-items.controller.js';
import { ActionItemsRepository } from './action-items.repository.js';
import { ActionItemsService } from './action-items.service.js';

@Module({
	imports: [DatabaseModule],
	controllers: [ActionItemsController],
	providers: [ActionItemsRepository, ActionItemsService],
})
export class ActionItemsModule {}
