import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import type { Database } from '../database/client.js';
import { DATABASE_TOKEN } from '../database/database.service.js';
import { REDIS_TOKEN } from '../redis/redis.service.js';

interface PingableRedis {
	ping(): Promise<unknown>;
}

@Controller('health')
export class HealthController {
	constructor(
		private readonly health: HealthCheckService,
		private readonly indicator: HealthIndicatorService,
		@Inject(DATABASE_TOKEN) private readonly db: Database,
		@Inject(REDIS_TOKEN) private readonly redis: PingableRedis,
	) {}

	/** Liveness: the process is up. Never touches dependencies. */
	@Get()
	live(): { status: 'ok' } {
		return { status: 'ok' };
	}

	/** Readiness: 200 when every dependency answers, 503 otherwise (via TerminusModule). */
	@Get('ready')
	@HealthCheck()
	ready() {
		return this.health.check([
			() => this.checkDatabase(),
			() => this.checkRedis(),
		]);
	}

	private async checkDatabase(): Promise<HealthIndicatorResult> {
		const check = this.indicator.check('database');
		try {
			await this.db.execute(sql`select 1`);
			return check.up();
		} catch (error) {
			return check.down({ message: error instanceof Error ? error.message : 'unknown error' });
		}
	}

	private async checkRedis(): Promise<HealthIndicatorResult> {
		const check = this.indicator.check('redis');
		try {
			await this.redis.ping();
			return check.up();
		} catch (error) {
			return check.down({ message: error instanceof Error ? error.message : 'unknown error' });
		}
	}
}
