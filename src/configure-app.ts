import { RequestMethod, type INestApplication } from '@nestjs/common';

const API_PREFIX = 'api/v1';

/** Settings shared by the real server and the test app. */
export function configureApp(app: INestApplication): void {
	app.setGlobalPrefix(API_PREFIX, {
		exclude: [
			// Probes stay at the root so orchestrators don't depend on API versioning.
			'health',
			'health/ready',
			// With a global prefix the adapter mounts Nest's 404 handler only under the
			// prefix and at each excluded path, so unknown root paths would get the
			// adapter's bare 404. A root wildcard here gets them the standard error body.
			// The method is one no route uses, because exclusions also strip the prefix
			// from any route they match.
			{ path: '{*path}', method: RequestMethod.OPTIONS },
		],
	});
}
