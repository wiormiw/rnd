import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
	Query,
} from '@nestjs/common';
import { unwrap } from '../common/result.js';
import {
	idParams,
	paginationQuery,
	type IdParams,
	type Page,
	type Pagination,
} from '../common/schemas.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
	cardInsertSchema,
	cardUpdateSchema,
	type Card,
	type CardInsert,
	type CardUpdate,
} from './card.schema.js';
import { CardsService } from './cards.service.js';

@Controller()
export class CardsController {
	constructor(private readonly service: CardsService) {}

	@Post('topics/:id/cards')
	@HttpCode(HttpStatus.CREATED)
	async create(
		@Param(new ZodValidationPipe(idParams)) params: IdParams,
		@Body(new ZodValidationPipe(cardInsertSchema)) body: CardInsert,
	): Promise<Card> {
		return unwrap(await this.service.create(params.id, body));
	}

	@Get('topics/:id/cards')
	async listByTopic(
		@Param(new ZodValidationPipe(idParams)) params: IdParams,
		@Query(new ZodValidationPipe(paginationQuery)) query: Pagination,
	): Promise<Page<Card>> {
		return unwrap(await this.service.listByTopic(params.id, query));
	}

	@Get('cards/:id')
	async findOne(@Param(new ZodValidationPipe(idParams)) params: IdParams): Promise<Card> {
		return unwrap(await this.service.findById(params.id));
	}

	@Patch('cards/:id')
	async update(
		@Param(new ZodValidationPipe(idParams)) params: IdParams,
		@Body(new ZodValidationPipe(cardUpdateSchema)) body: CardUpdate,
	): Promise<Card> {
		return unwrap(await this.service.update(params.id, body));
	}

	@Delete('cards/:id')
	@HttpCode(HttpStatus.NO_CONTENT)
	async remove(@Param(new ZodValidationPipe(idParams)) params: IdParams): Promise<void> {
		unwrap(await this.service.remove(params.id));
	}
}
