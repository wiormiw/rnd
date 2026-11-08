import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type { Logger };

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/** Paths whose values are always replaced with `[redacted]`. */
const REDACT_PATHS: readonly string[] = [
	'req.headers.authorization',
	'req.headers.cookie',
	'res.headers["set-cookie"]',
	'*.password',
	'*.token',
	'*.secret',
];

export interface CreateLoggerOptions {
	level?: LogLevel;
	/** Reported as the `service` field on every line. */
	name?: string;
	/** Extra redact paths, added to {@link REDACT_PATHS}. */
	redact?: readonly string[];
	/** Fields added to every line. */
	bindings?: Record<string, unknown>;
	/** Where lines are written. Defaults to stdout. */
	destination?: DestinationStream;
}

/**
 * Standalone pino logger. It knows nothing about the HTTP server, the config or any
 * infrastructure, so it can be created first and handed to everything else.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
	const { level = 'info', name, redact = [], bindings = {}, destination } = options;

	const loggerOptions: LoggerOptions = {
		level,
		base: name === undefined ? { ...bindings } : { service: name, ...bindings },
		timestamp: pino.stdTimeFunctions.isoTime,
		redact: { paths: [...REDACT_PATHS, ...redact], censor: '[redacted]' },
		formatters: {
			level: (label) => ({ level: label }),
		},
		serializers: {
			err: pino.stdSerializers.err,
			req: pino.stdSerializers.req,
			res: pino.stdSerializers.res,
		},
	};

	return destination ? pino(loggerOptions, destination) : pino(loggerOptions);
}

/** A logger that discards everything. Handy in tests. */
export function createSilentLogger(): Logger {
	return createLogger({ level: 'silent' });
}

/** The process-wide logger, for code that has no request logger to hand. */
export const defaultLogger = createLogger({ level: 'info', name: 'rnd' });
