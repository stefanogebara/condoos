import { defineConfig, devices } from '@playwright/test';

const localBaseURL = 'http://127.0.0.1:6175';
const localApiURL = 'http://127.0.0.1:6312/api';
const baseURL = process.env.E2E_BASE_URL || localBaseURL;
const apiURL = process.env.E2E_API_URL || localApiURL;

if (!process.env.E2E_BASE_URL && !process.env.E2E_API_URL) {
  process.env.E2E_API_URL = localApiURL;
}
const vercelBypassSecret =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
  process.env.VERCEL_PROTECTION_BYPASS ||
  process.env.VERCEL_BYPASS_SECRET;

// Only delegate server management when the user is testing against a
// local URL. For remote (vercel/fly.io) we never spawn anything.
// `reuseExistingServer` is enabled when the caller has set E2E_BASE_URL
// pointing at localhost — that lets `npm run dev:e2e` keep a long-lived
// stack while iterating, but Playwright still owns the lifecycle when
// no servers are up yet (heals after a crash or shell taking them down).
const isLocalBase = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)/.test(baseURL);
const reuseExisting = isLocalBase && !!process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  // The leak/visual specs walk many routes per test (10+ pages with a
  // login, a goto, a 800 ms render wait and a screenshot) and were
  // hitting the previous 45 s ceiling under combined-suite load on
  // real Chrome. Bump per-test budget so legitimate work finishes;
  // genuine bugs still surface via the inner `expect.toEqual` checks.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    extraHTTPHeaders: vercelBypassSecret
      ? {
          'x-vercel-protection-bypass': vercelBypassSecret,
          'x-vercel-set-bypass-cookie': 'true',
        }
      : undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' } },
  ],
  // Two webServers so Playwright health-checks each one independently.
  // If the API dies mid-suite Playwright will surface it immediately
  // instead of every spec failing with ECONNREFUSED.
  webServer: isLocalBase
    ? [
        {
          command: 'npm run e2e:seed && npm run e2e:server',
          url: `${apiURL.replace(/\/api\/?$/, '')}/api/health`,
          reuseExistingServer: reuseExisting,
          timeout: 300_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: 'npm run e2e:client',
          url: baseURL,
          reuseExistingServer: reuseExisting,
          timeout: 180_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
});
