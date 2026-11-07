import { Injectable, Optional } from '@nestjs/common';
import type { PipeTransform, ArgumentMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates values against a Zod schema when one is provided. Used in two ways:
 *
 * 1. Globally (via `APP_PIPE`) with no schema: passes every value through
 *    unchanged so it does not interfere with undecorated parameters.
 *
 * 2. Per-parameter: instantiated manually as `@Body(new ZodValidationPipe(schema))`
 *    with a schema. A `ZodError` is re-thrown and caught by `AllExceptionsFilter`,
 *    which formats it as a 400 response with field-level error details.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
	// @Optional(): as an APP_PIPE provider Nest cannot resolve the schema parameter
	// (its metadata is `Object`), so it must inject `undefined` instead.
	constructor(@Optional() private readonly schema?: ZodType) {}

	transform(value: unknown, _metadata: ArgumentMetadata): unknown {
		if (!this.schema) return value;
		return this.schema.parse(value);
	}
}
