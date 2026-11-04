import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import * as z from 'zod';

const liveResponse = z.object({ status: z.literal('ok') });

const readyResponse = z.object({
	status: z.enum(['ok', 'unavailable']),
	checks: z.record(
		z.string(),
		z.object({ status: z.enum(['ok', 'fail']), durationMs: z.number() }),
	),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
	// Liveness: the process is up. Never touches dependencies.
	app.get(
		'/health',
		{ config: { rateLimit: false }, schema: { response: { 200: liveResponse } } },
		async () => ({
			status: 'ok' as const,
		}),
	);

	// Readiness: every infrastructure resource passes its (time-bounded) check.
	// Failure details go to the logs, not to the caller.
	app.get(
		'/health/ready',
		{
			config: { rateLimit: false },
			schema: { response: { 200: readyResponse, 503: readyResponse } },
		},
		async (_request, reply) => {
			const results = await app.lifecycle.check();
			const checks = Object.fromEntries(
				Object.entries(results).map(([name, { ok, durationMs }]) => [
					name,
					{ status: ok ? ('ok' as const) : ('fail' as const), durationMs },
				]),
			);
			const healthy = Object.values(results).every((result) => result.ok);
			return reply
				.code(healthy ? 200 : 503)
				.send({ status: healthy ? 'ok' : 'unavailable', checks });
		},
	);
};
