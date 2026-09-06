import { defineConfig, devices } from '@playwright/test';

const SERVER_PORT = 3101;
const WEB_PORT = 5273;

/**
 * End-to-end smoke tests against the real server (mock LLM, in-memory store)
 * and the Vite dev server. Run with `pnpm e2e` after `pnpm exec playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'pnpm --filter @loop-agent/server dev',
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(SERVER_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        LLM_PROVIDER: 'mock',
        DATABASE_URL: 'memory',
        DATA_DIR: './data/e2e',
        LOG_LEVEL: 'warn',
        MOCK_DELAY_MS: '200',
      },
    },
    {
      command: `pnpm --filter @loop-agent/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: `http://localhost:${SERVER_PORT}` },
    },
  ],
});
