// Verifies PostHog event ingestion end-to-end: hits the live landing,
// observes the actual /e network calls leaving the browser to PostHog,
// and asserts our funnel events are in the captured payloads.
import { expect, test } from '@playwright/test';

test.skip(
  process.env.E2E_POSTHOG_LIVE !== '1',
  'Set E2E_POSTHOG_LIVE=1 to verify live PostHog ingestion against the deployed site.',
);

test('PostHog: landing_view fires from the live deploy', async ({ page }) => {
  test.setTimeout(60_000);
  const captures: Array<{ url: string; body: string }> = [];
  const allHosts = new Set<string>();
  page.on('console', (msg) => { if (/analytics|posthog/i.test(msg.text())) console.log('[browser]', msg.text()); });

  // PostHog SDK posts to many endpoints depending on its config: /e/, /i/v0/e/,
  // /decide, /batch, /array, etc. Capture anything pointing at posthog.com.
  const allReqs: string[] = [];
  page.on('request', (req) => {
    const u = req.url();
    allReqs.push(`${req.method()} ${u}`);
    try { allHosts.add(new URL(u).host); } catch {}
    const body = req.postData() ?? '';
    if (/posthog/i.test(u) || /landing_view|condoos/i.test(body)) {
      captures.push({ url: u, body });
    }
  });

  await page.goto('https://condoos-ten.vercel.app/', { waitUntil: 'networkidle' });
  // Wait for the lazy posthog chunk to load first.
  await page.waitForTimeout(3000);

  // Diagnostic: check PostHog state from inside the page
  const phState = await page.evaluate(() => {
    // @ts-expect-error
    const ph = window.posthog;
    return {
      hasWindowPostHog: typeof ph !== 'undefined',
      isLoaded: ph?.__loaded ?? null,
      hasCapture: typeof ph?.capture === 'function',
      hasFlush: typeof ph?.flush === 'function',
      hasSendRequest: typeof ph?._send_request === 'function',
      configKeys: ph?.config ? Object.keys(ph.config).slice(0, 20) : null,
      requestBatching: ph?.config?.request_batching,
      apiHost: ph?.config?.api_host,
    };
  });
  console.log('PostHog state:', JSON.stringify(phState));

  // Try every flush method we can think of
  await page.evaluate(async () => {
    // @ts-expect-error
    const ph = window.posthog;
    if (!ph) return;
    try { ph.capture('e2e_in_browser', { source: 'pw' }); } catch (e) { console.log('capture err', e); }
    try { ph.flush?.(); } catch (e) { console.log('flush err', e); }
  });
  await page.waitForTimeout(3000);
  await page.goto('about:blank');
  await page.waitForTimeout(2000);

  // Debug: dump every request to a known-good location
  console.log('=== ALL REQUESTS ===');
  for (const r of allReqs) console.log(r);
  console.log('=== POSTHOG-RELATED ===');
  for (const c of captures) console.log(`${c.url} body=${c.body.slice(0, 200)}`);

  const allBodies = captures.map((c) => `[${c.url}] ${c.body}`).join('\n');
  expect(allBodies).toMatch(/landing_view/);
  expect(allBodies).toMatch(/condoos/);
});
