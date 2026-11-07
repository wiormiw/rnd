import type { AppError } from './errors.js';

export interface Ok<T> {
	readonly ok: true;
	readonly value: T;
}

export interface Err<E> {
	readonly ok: false;
	readonly error: E;
}

/** A value, or the reason there isn't one. Errors are values, not control flow. */
export type Result<T, E = AppError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

// fallow-ignore-next-line unused-export
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
	return result.ok ? ok(fn(result.value)) : result;
}

// fallow-ignore-next-line unused-export
export function andThen<T, U, E>(
	result: Result<T, E>,
	fn: (value: T) => Result<U, E>,
): Result<U, E> {
	return result.ok ? fn(result.value) : result;
}

// fallow-ignore-next-line unused-export
export async function andThenAsync<T, U, E>(
	result: Result<T, E>,
	fn: (value: T) => Promise<Result<U, E>>,
): Promise<Result<U, E>> {
	return result.ok ? fn(result.value) : result;
}

export function fromNullable<T, E>(value: T | null | undefined, onMissing: () => E): Result<T, E> {
	return value === null || value === undefined ? err(onMissing()) : ok(value);
}

/**
 * Leave Result-land: return the value, or throw the error. Meant for the edge
 * (route handlers), where the central error handler turns it into a response.
 */
export function unwrap<T, E extends Error>(result: Result<T, E>): T {
	if (result.ok) return result.value;
	throw result.error;
}
