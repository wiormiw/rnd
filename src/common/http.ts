import type { ServerResponse } from 'node:http';

/** Write a JSON body on a raw response, bypassing Nest's serializer. */
export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
	res.statusCode = statusCode;
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(body));
}
