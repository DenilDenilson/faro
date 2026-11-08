import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    fileParallelism: false,
    env: { NODE_ENV: 'test', TURSO_DATABASE_URL: 'file::memory:' },
  },
});
