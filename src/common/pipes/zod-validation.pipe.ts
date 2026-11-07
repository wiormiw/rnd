import { Injectable } from '@nestjs/common';
import type { PipeTransform, ArgumentMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Per-parameter Zod validation pipe. Always instantiated manually:
 * `@Body(new ZodValidationPipe(schema))`, `@Param(...)`, `@Query(...)`.
 * A `ZodError` is re-thrown and caught by `AllExceptionsFilter`, which
 * formats it as a 400 response with field-level error details.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
	constructor(private readonly schema: ZodType) {}

	transform(value: unknown, _metadata: ArgumentMetadata): unknown {
		return this.schema.parse(value);
	}
}
