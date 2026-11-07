import { Global, Module } from '@nestjs/common';

/** Injection token for the wall clock, so tests can control time. */
export const CLOCK = Symbol('CLOCK');

export interface Clock {
	now(): Date;
}

@Global()
@Module({
	providers: [{ provide: CLOCK, useValue: { now: () => new Date() } satisfies Clock }],
	exports: [CLOCK],
})
export class ClockModule {}
