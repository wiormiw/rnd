import { describe, expect, it, vi } from 'vitest';
import { abortable, isTimeoutError, timeoutSignal } from '../lib/abort.js';

describe('abortable', () => {
	it('resolves with the work result', async () => {
		await expect(abortable(Promise.resolve(1), new AbortController().signal)).resolves.toBe(1);
	});

	it('rejects with the reason and calls onAbort when aborted mid-flight', async () => {
		const controller = new AbortController();
		const onAbort = vi.fn();
		const result = abortable(new Promise<never>(() => {}), controller.signal, onAbort);
		controller.abort(new Error('stop'));

		await expect(result).rejects.toThrow('stop');
		expect(onAbort).toHaveBeenCalledOnce();
	});

	it('rejects immediately for an already aborted signal', async () => {
		const onAbort = vi.fn();
		await expect(
			abortable(Promise.resolve(1), AbortSignal.abort(new Error('late')), onAbort),
		).rejects.toThrow('late');
		expect(onAbort).toHaveBeenCalledOnce();
	});
});

describe('timeoutSignal', () => {
	it('aborts with a TimeoutError after the delay', async () => {
		const signal = timeoutSignal(10);
		await expect(abortable(new Promise<never>(() => {}), signal)).rejects.toSatisfy(isTimeoutError);
	});

	it('also follows its parents', () => {
		const parent = new AbortController();
		const signal = timeoutSignal(10_000, parent.signal, undefined);
		parent.abort(new Error('parent'));
		expect(signal.aborted).toBe(true);
		expect(isTimeoutError(signal.reason)).toBe(false);
	});
});
