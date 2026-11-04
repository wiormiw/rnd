import fp from 'fastify-plugin';
import type { Infrastructure } from '../infrastructure/index.js';

declare module 'fastify' {
	interface FastifyInstance {
		lifecycle: Infrastructure['lifecycle'];
		redis: Infrastructure['redis'];
	}
}

export interface InfrastructurePluginOptions {
	infra: Infrastructure;
}

/**
 * Exposes the lifecycle on the app and disposes the infrastructure when the app
 * closes. Starting is the caller's job (see index.ts): it decides what to do
 * when startup fails.
 *
 * Fastify drains in-flight requests before running onClose hooks, so resources
 * are only stopped once nothing is using them.
 */
export default fp<InfrastructurePluginOptions>(
	async function infrastructurePlugin(app, { infra }) {
		app.decorate('lifecycle', infra.lifecycle);
		app.decorate('redis', infra.redis);
		app.addHook('onClose', async () => {
			await infra[Symbol.asyncDispose]();
		});
	},
	{ name: 'infrastructure' },
);
