import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
mkdirSync('work', { recursive: true });
const port = 4322;
const localChromium =
  process.env.CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: !process.env.CI && localChromium ? { executablePath: localChromium } : {},
  },
  webServer: {
    command: `pnpm dev --port ${port} --ignore-lock`,
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      FARO_PASSWORD: 'test-only-faro-password',
      FARO_SESSION_SECRET: randomBytes(32).toString('hex'),
      TURSO_DATABASE_URL: `file:./work/e2e-${Date.now()}.db`,
      NODE_ENV: 'development',
    },
  },
});
