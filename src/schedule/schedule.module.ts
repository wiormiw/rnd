import { Module } from '@nestjs/common';
import { CurriculumModule } from '../curriculum/curriculum.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ScheduleController } from './schedule.controller.js';
import { ScheduleRepository } from './schedule.repository.js';
import { ScheduleService } from './schedule.service.js';

@Module({
	imports: [DatabaseModule, CurriculumModule],
	controllers: [ScheduleController],
	providers: [ScheduleRepository, ScheduleService],
})
export class ScheduleModule {}
