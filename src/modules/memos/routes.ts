import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import * as z from 'zod';
import { unwrap } from '../../lib/result.js';
import { errorResponses, idParams, paginated, paginationQuery } from '../../lib/schemas.js';
import { createMemoBody, memoSchema } from './schema.js';

/**
 * Thin edge: parse and validate (schemas), call the service, leave Result-land
 * with `unwrap`. Status codes for errors are decided by the error handler.
 */
export const memoRoutes: FastifyPluginAsyncZod = async (app) => {
	const memos = app.services.memos;

	app.post(
		'/',
		{ schema: { body: createMemoBody, response: { 201: memoSchema, ...errorResponses } } },
		async (request, reply) => {
			const memo = unwrap(await memos.create(request.body));
			return reply.code(201).send(memo);
		},
	);

	app.get(
		'/',
		{
			schema: {
				querystring: paginationQuery,
				response: { 200: paginated(memoSchema), ...errorResponses },
			},
		},
		async (request) => unwrap(await memos.list(request.query)),
	);

	app.get(
		'/:id',
		{ schema: { params: idParams, response: { 200: memoSchema, ...errorResponses } } },
		async (request) => unwrap(await memos.get(request.params.id)),
	);

	app.delete(
		'/:id',
		{ schema: { params: idParams, response: { 204: z.null(), ...errorResponses } } },
		async (request, reply) => {
			unwrap(await memos.remove(request.params.id));
			return reply.code(204).send(null);
		},
	);
};
