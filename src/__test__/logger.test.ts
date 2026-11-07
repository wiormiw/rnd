import { describe, expect, it } from 'vitest';
import { createLogger } from '../common/logger.js';

function capture() {
	const lines: Record<string, unknown>[] = [];
	const destination = {
		write(chunk: string) {
			lines.push(JSON.parse(chunk) as Record<string, unknown>);
		},
	};
	return { lines, destination };
}

describe('createLogger', () => {
	it('writes ISO time, a level label and the service name', () => {
		const { lines, destination } = capture();
		createLogger({ name: 'svc', destination }).info('hello');

		expect(lines[0]).toMatchObject({ level: 'info', service: 'svc', msg: 'hello' });
		expect(String(lines[0]?.['time'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('respects the level', () => {
		const { lines, destination } = capture();
		const logger = createLogger({ level: 'warn', destination });
		logger.info('dropped');
		logger.warn('kept');

		expect(lines.map((line) => line['msg'])).toEqual(['kept']);
	});

	it('redacts default and extra paths', () => {
		const { lines, destination } = capture();
		createLogger({ redact: ['user.ssn'], destination }).info(
			{
				req: { headers: { authorization: 'Bearer secret' } },
				user: { password: 'hunter2', ssn: '123' },
			},
			'x',
		);

		const text = JSON.stringify(lines[0]);
		expect(text).not.toContain('Bearer secret');
		expect(text).not.toContain('hunter2');
		expect(text).not.toContain('123');
		expect(text).toContain('[redacted]');
	});

	it('serializes errors', () => {
		const { lines, destination } = capture();
		createLogger({ destination }).error({ err: new Error('boom') }, 'failed');

		expect(lines[0]?.['err']).toMatchObject({ type: 'Error', message: 'boom' });
	});

	it('adds bindings and children inherit them', () => {
		const { lines, destination } = capture();
		createLogger({ bindings: { env: 'test' }, destination })
			.child({ component: 'db' })
			.info('hi');

		expect(lines[0]).toMatchObject({ env: 'test', component: 'db' });
	});
});
