import {
	Injectable,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { defaultLogger } from '../common/logger.js';
import { timeoutSignal } from '../common/abort.js';
import { createRedis, type RedisClient } from './client.js';
import { createRedisTokenBucket, type TokenBucket } from './token-bucket.js';

export const REDIS_TOKEN = Symbol('REDIS');
export const TOKEN_BUCKET_TOKEN = Symbol('TOKEN_BUCKET');

@Injectable()
export class RedisService implements OnApplicationBootstrap, OnApplicationShutdown {
	readonly #redis: ReturnType<typeof createRedis>;
	readonly #log = defaultLogger.child({ component: 'redis' });

	constructor(private readonly config: ConfigService) {
		this.#redis = createRedis(config.getAll(), this.#log);
	}

	get client(): RedisClient {
		return this.#redis.client;
	}

	get bucket(): TokenBucket {
		return createRedisTokenBucket(this.#redis.client);
	}

	async onApplicationBootstrap(): Promise<void> {
		await this.#redis.client.connect();
		this.#log.info('redis connected');
	}

	async onApplicationShutdown(): Promise<void> {
		const timeoutMs = this.config.get('LIFECYCLE_STOP_TIMEOUT_MS');
		const signal = timeoutSignal(timeoutMs);
		await this.#redis.stopClient(signal);
		this.#log.info('redis disconnected');
	}
}
