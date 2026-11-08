import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { unwrap } from '../common/result.js';
import { idParams, type IdParams, type Page } from '../common/schemas.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
	actionItemListQuery,
	type ActionItem,
	type ActionItemListQuery,
} from './action-item.schema.js';
import { ActionItemsService } from './action-items.service.js';

@Controller('action-items')
export class ActionItemsController {
	constructor(private readonly service: ActionItemsService) {}

	@Get()
	async list(
		@Query(new ZodValidationPipe(actionItemListQuery)) query: ActionItemListQuery,
	): Promise<Page<ActionItem>> {
		return unwrap(await this.service.list(query));
	}

	@Post(':id/complete')
	@HttpCode(HttpStatus.OK)
	async complete(@Param(new ZodValidationPipe(idParams)) params: IdParams): Promise<ActionItem> {
		return unwrap(await this.service.complete(params.id));
	}
}
