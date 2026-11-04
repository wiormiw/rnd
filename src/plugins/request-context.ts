import fp from 'fastify-plugin';
import { requestContext } from '../lib/request-context.js';

/**
 * Runs the rest of the request lifecycle (parsing, validation, handler, error
 * handler) inside an AsyncLocalStorage store, so any code below can read the
 * request id, logger and abort signal without them being passed around.
 *
 * Must use the callback form of the hook: `done` is called inside `run`.
 */
export default fp(
	async function requestContextPlugin(app) {
		app.addHook('onRequest', (request, reply, done) => {
			reply.header('x-request-id', request.id);
			requestContext.run(
				{
					requestId: request.id,
					logger: request.log,
					// Lazy: Fastify only wires the socket listener when it is read.
					get signal() {
						return request.signal;
					},
					startedAt: performance.now(),
				},
				done,
			);
		});
	},
	{ name: 'request-context' },
);
