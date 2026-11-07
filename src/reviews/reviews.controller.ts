import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { unwrap } from '../common/result.js';
import { idParams, paginationQuery, type Page } from '../common/schemas.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { reviewInsertSchema, type ReviewInsert, type ReviewLog } from './review.schema.js';
import { ReviewsService, type ReviewResult } from './reviews.service.js';

@Controller('cards/:id')
export class ReviewsController {
	constructor(private readonly service: ReviewsService) {}

	@Post('review')
	@HttpCode(HttpStatus.OK)
	async review(
		@Param(new ZodValidationPipe(idParams)) params: { id: string },
		@Body(new ZodValidationPipe(reviewInsertSchema)) body: ReviewInsert,
	): Promise<ReviewResult> {
		return unwrap(await this.service.review(params.id, body));
	}

	@Get('reviews')
	async list(
		@Param(new ZodValidationPipe(idParams)) params: { id: string },
		@Query(new ZodValidationPipe(paginationQuery)) query: { limit: number; offset: number },
	): Promise<Page<ReviewLog>> {
		return unwrap(await this.service.listByCard(params.id, query));
	}
}
