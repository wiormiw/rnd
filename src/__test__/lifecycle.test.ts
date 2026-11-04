import { describe, expect, it } from 'vitest';
import { Lifecycle, LifecycleError, type Resource } from '../lib/lifecycle.js';
import { createSilentLogger } from '../lib/logger.js';

const logger = createSilentLogger();
const never = () => new Promise<void>(() => {});

function recorder() {
	const events: string[] = [];
	const resource = (name: string, hooks: Partial<Resource> = {}): Resource => ({
		name,
		start: async () => void events.push(`start:${name}`),
		stop: async () => void events.push(`stop:${name}`),
		...hooks,
	});
	return { events, resource };
}

describe('Lifecycle', () => {
	it('starts in order and stops in reverse order', async () => {
		const { events, resource } = recorder();
		const lifecycle = new Lifecycle([resource('a'), resource('b'), resource('c')], logger);

		await lifecycle.start();
		expect(lifecycle.state).toBe('running');
		await lifecycle.stop();

		expect(events).toEqual(['start:a', 'start:b', 'start:c', 'stop:c', 'stop:b', 'stop:a']);
		expect(lifecycle.state).toBe('stopped');
	});

	it('rolls back, including the resource that failed, when a start fails', async () => {
		const { events, resource } = recorder();
		const lifecycle = new Lifecycle(
			[
				resource('a'),
				resource('b', {
					start: async () => {
						throw new Error('boom');
					},
				}),
				resource('c'),
			],
			logger,
		);

		await expect(lifecycle.start()).rejects.toThrow(LifecycleError);
		expect(events).toEqual(['start:a', 'stop:b', 'stop:a']);
		expect(lifecycle.state).toBe('stopped');
	});

	it('times out a start that never settles, even if the resource ignores its signal', async () => {
		const { events, resource } = recorder();
		const lifecycle = new Lifecycle([resource('slow', { start: never })], logger, { startMs: 20 });

		await expect(lifecycle.start()).rejects.toThrow('slow: start timed out after 20ms');
		expect(events).toEqual(['stop:slow']);
	});

	it('honours a per-resource timeout override', async () => {
		const { resource } = recorder();
		const lifecycle = new Lifecycle(
			[resource('slow', { start: never, timeouts: { startMs: 10 } })],
			logger,
			{ startMs: 60_000 },
		);

		await expect(lifecycle.start()).rejects.toThrow('timed out after 10ms');
	});

	it('aborts a start in progress when the caller aborts', async () => {
		const { resource } = recorder();
		const controller = new AbortController();
		const lifecycle = new Lifecycle([resource('slow', { start: never })], logger);

		const started = lifecycle.start(controller.signal);
		controller.abort(new Error('shutdown'));

		await expect(started).rejects.toThrow('slow: start aborted');
	});

	it('stop() cancels a start in progress and cleans up', async () => {
		const { events, resource } = recorder();
		let received: AbortSignal | undefined;
		const lifecycle = new Lifecycle(
			[
				resource('a'),
				resource('b', {
					start: (signal) => {
						received = signal;
						return never();
					},
				}),
			],
			logger,
		);

		const started = lifecycle.start();
		started.catch(() => {});
		await new Promise((resolve) => setImmediate(resolve));
		await lifecycle.stop();

		expect(received?.aborted).toBe(true);
		await expect(started).rejects.toThrow('b: start aborted');
		expect(events).toEqual(['start:a', 'stop:b', 'stop:a']);
	});

	it('stop() is idempotent and never throws, even when a stop fails or hangs', async () => {
		const { events, resource } = recorder();
		const lifecycle = new Lifecycle(
			[
				resource('a'),
				resource('hangs', { stop: never }),
				resource('fails', {
					stop: async () => {
						throw new Error('nope');
					},
				}),
			],
			logger,
			{ stopMs: 20 },
		);

		await lifecycle.start();
		await Promise.all([lifecycle.stop(), lifecycle.stop()]);
		await lifecycle.stop();

		// Both bad resources were skipped and `a` was still stopped, exactly once.
		expect(events.filter((event) => event === 'stop:a')).toHaveLength(1);
		expect(lifecycle.state).toBe('stopped');
	});

	it('refuses to start twice or after stopping', async () => {
		const lifecycle = new Lifecycle([], logger);
		await lifecycle.start();
		await expect(lifecycle.start()).rejects.toThrow('cannot start from state "running"');
		await lifecycle.stop();
		await expect(lifecycle.start()).rejects.toThrow('cannot start from state "stopped"');
	});

	it('stops on scope exit with `await using`', async () => {
		const { events, resource } = recorder();
		{
			await using lifecycle = new Lifecycle([resource('a'), resource('b')], logger);
			await lifecycle.start();
		}
		expect(events).toEqual(['start:a', 'start:b', 'stop:b', 'stop:a']);
	});

	it('check() reports healthy, failing and hanging resources without throwing', async () => {
		const lifecycle = new Lifecycle(
			[
				{ name: 'ok', check: async () => {} },
				{
					name: 'bad',
					check: async () => {
						throw new Error('down');
					},
				},
				{ name: 'hang', check: never },
				{ name: 'no-check' },
			],
			logger,
			{ checkMs: 20 },
		);

		const results = await lifecycle.check();

		expect(Object.keys(results).sort()).toEqual(['bad', 'hang', 'ok']);
		expect(results['ok']).toMatchObject({ ok: true });
		expect(results['bad']).toMatchObject({ ok: false });
		expect(results['hang']).toMatchObject({ ok: false });
		expect(results['hang']?.error).toContain('timed out after 20ms');
	});
});
