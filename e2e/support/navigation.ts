import { type Page } from '@playwright/test';

const VERCEL_CHECKPOINT =
  /Vercel Security Checkpoint|Falha ao verificar seu navegador|Failed to verify your browser|Estamos verificando seu navegador|We're verifying your browser|Código 21|Code 21/i;

export async function assertNotVercelCheckpoint(page: Page) {
  const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  if (VERCEL_CHECKPOINT.test(body)) {
    throw new Error(
      'Vercel Deployment Protection blocked this browser run. Set VERCEL_AUTOMATION_BYPASS_SECRET ' +
      '(or VERCEL_PROTECTION_BYPASS) so Playwright sends x-vercel-protection-bypass.'
    );
  }
}

export async function gotoApp(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 7_500 }).catch(() => {});
  await assertNotVercelCheckpoint(page);
}
