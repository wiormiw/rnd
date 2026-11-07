import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
	use(_req: IncomingMessage, res: ServerResponse, next: () => void): void {
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('X-Frame-Options', 'DENY');
		res.setHeader('X-XSS-Protection', '0');
		res.setHeader('Referrer-Policy', 'no-referrer');
		res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
		next();
	}
}
