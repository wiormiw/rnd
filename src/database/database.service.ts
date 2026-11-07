import {
	Injectable,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { createLogger } from '../common/logger.js';
import { timeoutSignal } from '../common/abort.js';
import { createDatabase, type Database } from './client.js';

export const DATABASE_TOKEN = Symbol('DATABASE');

@Injectable()
export class DatabaseService implements OnApplicationBootstrap, OnApplicationShutdown {
	readonly #db: ReturnType<typeof createDatabase>;
	readonly #log = createLogger({ level: 'info', name: 'rnd' }).child({ component: 'db' });

	constructor(private readonly config: ConfigService) {
		this.#db = createDatabase(config.getAll(), this.#log);
	}

	get db(): Database {
		return this.#db.db;
	}

	async onApplicationBootstrap(): Promise<void> {
		const timeoutMs = this.config.get('LIFECYCLE_START_TIMEOUT_MS');
		const signal = timeoutSignal(timeoutMs);
		await this.#db.ping(signal);
		this.#log.info('database connected');
	}

	async onApplicationShutdown(): Promise<void> {
		const timeoutMs = this.config.get('LIFECYCLE_STOP_TIMEOUT_MS');
		// Give the pool a chance to drain; force-close if the lifecycle gives up.
		const signal = timeoutSignal(timeoutMs);
		const force = () => void this.#db.client.end({ timeout: 0 });
		signal.addEventListener('abort', force, { once: true });
		try {
			await this.#db.client.end({ timeout: this.config.get('DB_END_TIMEOUT') });
		} finally {
			signal.removeEventListener('abort', force);
		}
		this.#log.info('database disconnected');
	}
}
