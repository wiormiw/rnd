import fp from 'fastify-plugin';
import type { Services } from '../modules/index.js';

declare module 'fastify' {
	interface FastifyInstance {
		services: Services;
	}
}

export interface ServicesPluginOptions {
	services: Services;
}

/** Routes reach the business layer through `app.services`, never the database. */
export default fp<ServicesPluginOptions>(
	async function servicesPlugin(app, { services }) {
		app.decorate('services', services);
	},
	{ name: 'services', dependencies: ['infrastructure'] },
);
