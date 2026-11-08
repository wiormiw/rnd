/** Whole seconds for a header value: rounded up, never below 1. */
export const ceilSeconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));
