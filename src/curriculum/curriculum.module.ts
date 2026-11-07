import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CurriculumController } from './curriculum.controller.js';
import { CurriculumRepository } from './curriculum.repository.js';
import { CurriculumService } from './curriculum.service.js';

@Module({
	imports: [DatabaseModule],
	controllers: [CurriculumController],
	providers: [CurriculumRepository, CurriculumService],
	exports: [CurriculumService],
})
export class CurriculumModule {}
