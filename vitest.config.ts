import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Agent worktrees live under .claude/ and contain their own copies of the tests.
		exclude: [...configDefaults.exclude, '.claude/**'],
	},
});
