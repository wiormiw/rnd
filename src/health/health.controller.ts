import { Controller, Get, Inject, Res, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import type { ServerResponse } from 'node:http';
import { sql } from 'drizzle-orm';
import type { Database } from '../database/client.js';
import { DATABASE_TOKEN } from '../database/database.service.js';
import { REDIS_TOKEN } from '../redis/redis.service.js';
import { RateLimit } from '../common/guards/rate-limit.guard.js';
import { createLogger } from '../common/logger.js';

interface PingableRedis {
	ping(): Promise<unknown>;
}

const log = createLogger({ level: 'info', name: 'rnd' }).child({ component: 'health' });

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
	res.statusCode = statusCode;
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(body));
}

// Probes must never be throttled: an orchestrator polling them would drain the bucket.
@RateLimit(false)
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

	/**
	 * Readiness: 200 when every dependency answers, 503 with the Terminus body
	 * otherwise. Sent by hand because the edge filter turns every 5xx HttpException
	 * into a generic 500, which would hide the per-dependency result.
	 */
	@Get('ready')
	@HealthCheck()
	async ready(@Res() res: ServerResponse): Promise<void> {
		try {
			sendJson(
				res,
				200,
				await this.health.check([() => this.checkDatabase(), () => this.checkRedis()]),
			);
		} catch (error) {
			if (error instanceof ServiceUnavailableException) {
				return sendJson(res, 503, error.getResponse());
			}
			throw error;
		}
	}

	// The cause is logged, never returned: callers only learn which dependency is down.
	private async checkDatabase(): Promise<HealthIndicatorResult> {
		const check = this.indicator.check('database');
		try {
			await this.db.execute(sql`select 1`);
			return check.up();
		} catch (error) {
			log.warn({ err: error, dependency: 'database' }, 'readiness check failed');
			return check.down();
		}
	}

	private async checkRedis(): Promise<HealthIndicatorResult> {
		const check = this.indicator.check('redis');
		try {
			await this.redis.ping();
			return check.up();
		} catch (error) {
			log.warn({ err: error, dependency: 'redis' }, 'readiness check failed');
			return check.down();
		}
	}
}
