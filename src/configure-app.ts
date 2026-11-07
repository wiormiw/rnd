import type { INestApplication } from '@nestjs/common';

const API_PREFIX = 'api/v1';

/** Settings shared by the real server and the test app. */
export function configureApp(app: INestApplication): void {
	// Probes stay at the root so orchestrators don't depend on API versioning.
	app.setGlobalPrefix(API_PREFIX, { exclude: ['health', 'health/ready'] });
}
