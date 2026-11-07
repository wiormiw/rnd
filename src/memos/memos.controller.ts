import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import type { Memo, MemoInsert, MemoUpdate } from './memo.schema.js';
import { memoInsertSchema, memoUpdateSchema } from './memo.schema.js';
import { MemosService } from './memos.service.js';
import { unwrap } from '../common/result.js';
import { idParams, paginationQuery, type Page } from '../common/schemas.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

@Controller('memos')
export class MemosController {
	constructor(private readonly service: MemosService) {}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	async create(@Body(new ZodValidationPipe(memoInsertSchema)) body: MemoInsert): Promise<Memo> {
		return unwrap(await this.service.create(body));
	}

	@Get()
	async list(
		@Query(new ZodValidationPipe(paginationQuery)) query: { limit: number; offset: number },
	): Promise<Page<Memo>> {
		return unwrap(await this.service.list(query));
	}

	@Get(':id')
	async findOne(@Param(new ZodValidationPipe(idParams)) params: { id: string }): Promise<Memo> {
		return unwrap(await this.service.findById(params.id));
	}

	@Patch(':id')
	async update(
		@Param(new ZodValidationPipe(idParams)) params: { id: string },
		@Body(new ZodValidationPipe(memoUpdateSchema)) body: MemoUpdate,
	): Promise<Memo> {
		return unwrap(await this.service.update(params.id, body));
	}

	@Delete(':id')
	@HttpCode(HttpStatus.NO_CONTENT)
	async remove(@Param(new ZodValidationPipe(idParams)) params: { id: string }): Promise<void> {
		unwrap(await this.service.remove(params.id));
	}
}
