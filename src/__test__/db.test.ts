import { describe, expect, it } from 'vitest';
import { createDatabase } from '../infrastructure/db/client.js';
import { toPostgresOptions } from '../infrastructure/db/options.js';
import { loadConfig } from '../lib/config.js';
import { Lifecycle, LifecycleError } from '../lib/lifecycle.js';
import { createSilentLogger } from '../lib/logger.js';

const logger = createSilentLogger();
const url = 'postgres://rnd:rnd@127.0.0.1:5432/rnd';
const redis = 'redis://127.0.0.1:6379';

describe('toPostgresOptions', () => {
	it('uses safe defaults and leaves unset options undefined', () => {
		const options = toPostgresOptions(loadConfig({ DB_URL: url, REDIS_URL: redis }), logger);

		expect(options).toMatchObject({
			max: 10,
			min: 0,
			idle_timeout: 30,
			queue_timeout: 10,
			connect_timeout: 10,
			keep_alive: 60,
			prepare: true,
			fetch_types: true,
			debug: false,
		});
		expect(options.ssl).toBeUndefined();
		expect(options.max_lifetime).toBeUndefined();
		expect(options.connection).toEqual({
			application_name: 'rnd',
			statement_timeout: 30_000,
			idle_in_transaction_session_timeout: 60_000,
		});
	});

	it('maps every configurable option', () => {
		const options = toPostgresOptions(
			loadConfig({
				DB_URL: url,
				REDIS_URL: redis,
				DB_SSL: 'verify-full',
				DB_SSL_NEGOTIATION: 'direct',
				DB_CHANNEL_BINDING: 'require',
				DB_MAX: '20',
				DB_MIN: '2',
				DB_MAX_PIPELINE: '50',
				DB_SCHEDULER: 'false',
				DB_IDLE_TIMEOUT: '0',
				DB_QUEUE_TIMEOUT: '3',
				DB_CONNECT_TIMEOUT: '5',
				DB_MAX_LIFETIME: '1800',
				DB_BACKOFF: '2',
				DB_KEEP_ALIVE: '0',
				DB_PREPARE: 'false',
				DB_INFER: 'true',
				DB_FETCH_TYPES: 'false',
				DB_TARGET_SESSION_ATTRS: 'read-write',
				DB_PUBLICATIONS: 'pub',
				DB_SLOT: 'slot',
				DB_ONREAD: 'false',
				DB_UNREF_SOCKETS: 'true',
				DB_DEBUG: 'true',
				DB_LOCK_TIMEOUT_MS: '1000',
				DB_IDLE_SESSION_TIMEOUT_MS: '2000',
				DB_TIMEZONE: 'UTC',
				DB_DEFAULT_TRANSACTION_ISOLATION: 'serializable',
				DB_DEFAULT_TRANSACTION_READ_ONLY: 'true',
			}),
			logger,
		);

		expect(options).toMatchObject({
			ssl: 'verify-full',
			sslnegotiation: 'direct',
			channel_binding: 'require',
			max: 20,
			min: 2,
			max_pipeline: 50,
			scheduler: false,
			idle_timeout: 0,
			queue_timeout: 3,
			connect_timeout: 5,
			max_lifetime: 1800,
			backoff: 2,
			keep_alive: 0,
			prepare: false,
			infer: true,
			fetch_types: false,
			target_session_attrs: 'read-write',
			publications: 'pub',
			slot: 'slot',
			onread: false,
			unref_sockets: true,
		});
		expect(typeof options.debug).toBe('function');
		expect(options.connection).toMatchObject({
			lock_timeout: 1000,
			idle_session_timeout: 2000,
			TimeZone: 'UTC',
			default_transaction_isolation: 'serializable',
			default_transaction_read_only: true,
		});
	});
});

describe('createDatabase', () => {
	it('lets overrides win over the environment', async () => {
		await using database = createDatabase(
			loadConfig({ DB_URL: url, REDIS_URL: redis, DB_MAX: '5' }),
			logger,
			{
				max: 2,
			},
		);
		expect(database.client.options.max).toBe(2);
	});

	it('fails startup within the timeout when the database is unreachable, then cleans up', async () => {
		const env = loadConfig({
			DB_URL: 'postgres://rnd:rnd@127.0.0.1:1/rnd',
			REDIS_URL: redis,
			DB_END_TIMEOUT: '0',
		});
		const { resource } = createDatabase(env, logger);
		const lifecycle = new Lifecycle([resource], logger, { startMs: 1500 });

		await expect(lifecycle.start()).rejects.toThrow(LifecycleError);
		expect(lifecycle.state).toBe('stopped');
	}, 10_000);
});
