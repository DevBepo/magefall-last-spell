import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5180', headless: true, viewport: { width: 960, height: 640 } },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:5180',
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
