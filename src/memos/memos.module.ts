import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MemosController, TopicMemosController } from './memos.controller.js';
import { MemosRepository } from './memos.repository.js';
import { MemosService } from './memos.service.js';

@Module({
	imports: [DatabaseModule],
	controllers: [MemosController, TopicMemosController],
	providers: [MemosRepository, MemosService],
})
export class MemosModule {}
