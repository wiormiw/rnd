import { describe, expect, it } from 'vitest';
import { loadConfig } from '../lib/config.js';

const base = {
	DB_URL: 'postgres://rnd:rnd@localhost:5432/rnd',
	REDIS_URL: 'redis://localhost:6379',
};

function errorOf(fn: () => unknown): string {
	try {
		fn();
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
	return '';
}

describe('loadConfig', () => {
	it('applies defaults and leaves optional values undefined when unset', () => {
		const config = loadConfig(base);
		expect(config.PORT).toBe(3000);
		expect(config.NODE_ENV).toBe('development');
		expect(config.CORS_ORIGIN).toBeUndefined();
		expect(config.DB_SSL).toBeUndefined();
		expect(config.DB_MAX_LIFETIME).toBeUndefined();
	});

	it('treats blank values as unset', () => {
		const config = loadConfig({ ...base, PORT: '', CORS_ORIGIN: '  ', LOG_LEVEL: '', DB_SSL: '' });
		expect(config.PORT).toBe(3000);
		expect(config.CORS_ORIGIN).toBeUndefined();
		expect(config.LOG_LEVEL).toBe('info');
		expect(config.DB_SSL).toBeUndefined();
	});

	it('parses a comma separated CORS_ORIGIN', () => {
		const config = loadConfig({ ...base, CORS_ORIGIN: 'http://a.test, http://b.test' });
		expect(config.CORS_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
	});

	it('parses pool, boolean and timeout options', () => {
		const config = loadConfig({
			...base,
			DB_MAX: '5',
			DB_PREPARE: 'false',
			DB_DEBUG: '1',
			DB_SSL: 'require',
			REQUEST_TIMEOUT_MS: '1000',
		});
		expect(config.DB_MAX).toBe(5);
		expect(config.DB_PREPARE).toBe(false);
		expect(config.DB_DEBUG).toBe(true);
		expect(config.DB_SSL).toBe('require');
		expect(config.REQUEST_TIMEOUT_MS).toBe(1000);
	});

	it('reports every problem, one per variable, and tells missing from invalid', () => {
		const message = errorOf(() => loadConfig({ PORT: 'abc', DB_SSL: 'nope' }));
		expect(message).toContain('DB_URL: is required');
		expect(message).toMatch(/PORT: (?!is required)/);
		expect(message).toMatch(/DB_SSL: (?!is required)/);
	});
});
