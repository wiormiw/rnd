import { Injectable } from '@nestjs/common';
import { loadConfig, type Env } from '../lib/config.js';

@Injectable()
export class ConfigService {
	private readonly config: Env = loadConfig();

	get<K extends keyof Env>(key: K): Env[K] {
		return this.config[key];
	}

	getAll(): Env {
		return this.config;
	}
}
