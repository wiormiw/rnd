import { abortable, isTimeoutError, timeoutSignal } from './abort.js';
import type { Logger } from './logger.js';

export interface LifecycleTimeouts {
	startMs: number;
	stopMs: number;
	checkMs: number;
}

/**
 * Something with a lifecycle: a database pool, a cache, a queue client...
 * Every hook is optional and receives a signal that aborts on timeout (and, for
 * `start`, when the lifecycle is stopped while still starting).
 */
export interface Resource {
	readonly name: string;
	/** Per-resource override of the lifecycle timeouts. */
	readonly timeouts?: Partial<LifecycleTimeouts>;
	start?(signal: AbortSignal): Promise<void>;
	/** Resolve when healthy, reject when not. */
	check?(signal: AbortSignal): Promise<void>;
	stop?(signal: AbortSignal): Promise<void>;
}

export type LifecycleState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';

export interface CheckResult {
	ok: boolean;
	durationMs: number;
	error?: string;
}

export class LifecycleError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'LifecycleError';
	}
}

type Phase = 'start' | 'check' | 'stop';

const PHASE_TIMEOUT: Record<Phase, keyof LifecycleTimeouts> = {
	start: 'startMs',
	check: 'checkMs',
	stop: 'stopMs',
};

/**
 * Starts resources in order, stops them in reverse order, and bounds every
 * operation with a timeout and an AbortSignal.
 *
 * - `start()` rolls back (stops what was started) if any resource fails.
 * - `stop()` is idempotent, aborts a start that is still in progress, and never
 *   throws: a resource that fails or hangs is logged and skipped.
 * - `check()` runs every health check concurrently and never throws.
 */
export class Lifecycle implements AsyncDisposable {
	readonly #resources: readonly Resource[];
	readonly #logger: Logger;
	readonly #timeouts: LifecycleTimeouts;
	/** Aborted when `stop()` is called, which cancels a start in progress. */
	readonly #controller = new AbortController();
	#state: LifecycleState = 'idle';
	#started: Resource[] = [];
	#starting: Promise<void> | undefined;
	#teardown: Promise<void> | undefined;

	constructor(
		resources: readonly Resource[],
		logger: Logger,
		timeouts: Partial<LifecycleTimeouts> = {},
	) {
		this.#resources = resources;
		this.#logger = logger.child({ component: 'lifecycle' });
		this.#timeouts = { startMs: 15_000, stopMs: 10_000, checkMs: 2_000, ...timeouts };
	}

	get state(): LifecycleState {
		return this.#state;
	}

	/** Start every resource in order. `signal` lets the caller abort startup. */
	start(signal?: AbortSignal): Promise<void> {
		if (this.#state !== 'idle') {
			return Promise.reject(new LifecycleError(`cannot start from state "${this.#state}"`));
		}
		this.#state = 'starting';
		const own = this.#controller.signal;
		this.#starting = this.#start(signal ? AbortSignal.any([signal, own]) : own);
		return this.#starting;
	}

	/** Stop everything in reverse order. Safe to call any number of times. */
	async stop(): Promise<void> {
		this.#controller.abort(new LifecycleError('lifecycle is stopping'));
		await this.#starting?.catch(() => {});
		await this.#tearDown();
	}

	/** Makes `await using lifecycle = new Lifecycle(...)` stop it on scope exit. */
	async [Symbol.asyncDispose](): Promise<void> {
		await this.stop();
	}

	async check(): Promise<Record<string, CheckResult>> {
		const entries = await Promise.all(
			this.#resources
				.filter((resource) => resource.check !== undefined)
				.map(async (resource): Promise<[string, CheckResult]> => {
					const began = performance.now();
					try {
						await this.#run(resource, 'check');
						return [resource.name, { ok: true, durationMs: elapsed(began) }];
					} catch (err) {
						this.#logger.warn({ err, resource: resource.name }, 'health check failed');
						return [
							resource.name,
							{ ok: false, durationMs: elapsed(began), error: messageOf(err) },
						];
					}
				}),
		);
		return Object.fromEntries(entries);
	}

	async #start(signal: AbortSignal): Promise<void> {
		for (const resource of this.#resources) {
			// Tracked before starting so a resource that fails halfway is cleaned up too.
			this.#started.push(resource);
			try {
				await this.#run(resource, 'start', signal);
			} catch (err) {
				this.#logger.error({ err, resource: resource.name }, 'startup failed, rolling back');
				await this.#tearDown();
				throw err;
			}
		}
		this.#state = 'running';
		this.#logger.info({ resources: this.#resources.map((r) => r.name) }, 'lifecycle running');
	}

	#tearDown(): Promise<void> {
		this.#teardown ??= (async () => {
			this.#state = 'stopping';
			for (const resource of this.#started.toReversed()) {
				try {
					await this.#run(resource, 'stop');
				} catch (err) {
					this.#logger.error({ err, resource: resource.name }, 'stop failed, continuing');
				}
			}
			this.#started = [];
			this.#state = 'stopped';
			this.#logger.info('lifecycle stopped');
		})();
		return this.#teardown;
	}

	async #run(resource: Resource, phase: Phase, parent?: AbortSignal): Promise<void> {
		const hook = resource[phase];
		if (!hook) return;

		const ms = resource.timeouts?.[PHASE_TIMEOUT[phase]] ?? this.#timeouts[PHASE_TIMEOUT[phase]];
		const signal = timeoutSignal(ms, parent);
		const began = performance.now();
		try {
			// `abortable` bounds the wait even if the resource ignores its signal.
			await abortable(hook.call(resource, signal), signal);
			this.#logger.debug({ resource: resource.name, phase, ms: elapsed(began) }, 'ok');
		} catch (err) {
			const why = isTimeoutError(signal.reason)
				? `timed out after ${ms}ms`
				: signal.aborted
					? 'aborted'
					: 'failed';
			throw new LifecycleError(`${resource.name}: ${phase} ${why}`, { cause: err });
		}
	}
}

function elapsed(began: number): number {
	return Math.round(performance.now() - began);
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
