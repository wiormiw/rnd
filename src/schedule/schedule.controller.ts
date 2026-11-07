import { Controller, Get, Query } from '@nestjs/common';
import { unwrap } from '../common/result.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { dailyQuery, type DailySprint } from './schedule.schema.js';
import { ScheduleService } from './schedule.service.js';

@Controller('schedule')
export class ScheduleController {
	constructor(private readonly service: ScheduleService) {}

	@Get('daily')
	async daily(
		@Query(new ZodValidationPipe(dailyQuery)) query: { maxMinutes: number },
	): Promise<DailySprint> {
		return unwrap(await this.service.daily(query.maxMinutes));
	}
}
