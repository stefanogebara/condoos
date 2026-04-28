import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5175';
const stackCommand = 'npm run e2e:seed && npm run e2e:stack';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: stackCommand,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
