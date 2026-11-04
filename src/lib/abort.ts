/**
 * Settle with `work`, or reject with `signal.reason` as soon as the signal
 * aborts. The work itself keeps running unless `onAbort` cancels it, so pass
 * one whenever the underlying operation can be cancelled.
 */
export function abortable<T>(
	work: Promise<T>,
	signal: AbortSignal,
	onAbort?: () => void,
): Promise<T> {
	if (signal.aborted) {
		work.catch(() => {});
		onAbort?.();
		return Promise.reject(signal.reason);
	}

	return new Promise<T>((resolve, reject) => {
		const abort = () => {
			onAbort?.();
			reject(signal.reason);
		};
		signal.addEventListener('abort', abort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

/** A signal that aborts after `ms`, or when any of the `parents` aborts. */
export function timeoutSignal(ms: number, ...parents: (AbortSignal | undefined)[]): AbortSignal {
	const signals = parents.filter((parent): parent is AbortSignal => parent !== undefined);
	return AbortSignal.any([AbortSignal.timeout(ms), ...signals]);
}

export function isTimeoutError(reason: unknown): boolean {
	return reason instanceof Error && reason.name === 'TimeoutError';
}
