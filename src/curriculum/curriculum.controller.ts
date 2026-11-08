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
	Put,
} from '@nestjs/common';
import { unwrap } from '../common/result.js';
import { idParams, type IdParams } from '../common/schemas.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurriculumService } from './curriculum.service.js';
import {
	prerequisiteParams,
	type PrerequisiteParams,
	topicInsertSchema,
	topicUpdateSchema,
	type Topic,
	type TopicInsert,
	type TopicUpdate,
} from './topic.schema.js';

/** Root-level controller: `curriculum/order` and `topics/*` never collide. */
@Controller()
export class CurriculumController {
	constructor(private readonly service: CurriculumService) {}

	@Post('topics')
	@HttpCode(HttpStatus.CREATED)
	async create(@Body(new ZodValidationPipe(topicInsertSchema)) body: TopicInsert): Promise<Topic> {
		return unwrap(await this.service.create(body));
	}

	@Get('topics')
	async list(): Promise<Topic[]> {
		return unwrap(await this.service.list());
	}

	@Get('topics/:id')
	async findOne(@Param(new ZodValidationPipe(idParams)) params: IdParams): Promise<Topic> {
		return unwrap(await this.service.findById(params.id));
	}

	@Patch('topics/:id')
	async update(
		@Param(new ZodValidationPipe(idParams)) params: IdParams,
		@Body(new ZodValidationPipe(topicUpdateSchema)) body: TopicUpdate,
	): Promise<Topic> {
		return unwrap(await this.service.update(params.id, body));
	}

	@Delete('topics/:id')
	@HttpCode(HttpStatus.NO_CONTENT)
	async remove(@Param(new ZodValidationPipe(idParams)) params: IdParams): Promise<void> {
		unwrap(await this.service.remove(params.id));
	}

	@Put('topics/:id/prerequisites/:prerequisiteId')
	@HttpCode(HttpStatus.NO_CONTENT)
	async addPrerequisite(
		@Param(new ZodValidationPipe(prerequisiteParams)) params: PrerequisiteParams,
	): Promise<void> {
		unwrap(await this.service.addPrerequisite(params.id, params.prerequisiteId));
	}

	@Delete('topics/:id/prerequisites/:prerequisiteId')
	@HttpCode(HttpStatus.NO_CONTENT)
	async removePrerequisite(
		@Param(new ZodValidationPipe(prerequisiteParams)) params: PrerequisiteParams,
	): Promise<void> {
		unwrap(await this.service.removePrerequisite(params.id, params.prerequisiteId));
	}

	@Get('curriculum/order')
	async order(): Promise<Topic[]> {
		return unwrap(await this.service.order());
	}
}
