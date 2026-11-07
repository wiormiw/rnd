import { defineConfig } from 'drizzle-kit';

try {
	process.loadEnvFile();
} catch {
	// No .env file: rely on the real environment.
}

const url = process.env['DB_URL'];
if (!url) throw new Error('DB_URL is required');

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/database/schema.ts',
	out: './drizzle',
	dbCredentials: { url },
});
