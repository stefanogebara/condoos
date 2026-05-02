#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const baseUrl = (process.env.LH_BASE_URL || process.env.E2E_BASE_URL || 'https://condoos-ten.vercel.app').replace(/\/+$/, '');
const paths = (process.env.LH_PATHS || '/,/login,/onboarding')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const outDir = path.resolve(process.cwd(), 'test-results', 'lighthouse');

const budgets = {
  // The app is animation-heavy and currently scores in the 0.3-0.5 band under
  // Lighthouse's simulated throttling. Keep this as a regression floor while
  // stricter bundle/code-splitting work happens separately.
  performance: Number(process.env.LH_MIN_PERFORMANCE || 0.30),
  accessibility: Number(process.env.LH_MIN_ACCESSIBILITY || 0.85),
  bestPractices: Number(process.env.LH_MIN_BEST_PRACTICES || 0.85),
  seo: Number(process.env.LH_MIN_SEO || 0.80),
  totalBytes: Number(process.env.LH_MAX_TOTAL_BYTES || 2_200_000),
  scriptBytes: Number(process.env.LH_MAX_JS_BYTES || 950_000),
};

function urlFor(route) {
  if (/^https?:\/\//i.test(route)) return route;
  return `${baseUrl}${route.startsWith('/') ? route : `/${route}`}`;
}

function score(lhr, category) {
  return lhr.categories[category]?.score ?? 0;
}

function resourceBytes(lhr, resourceType) {
  const details = lhr.audits['resource-summary']?.details;
  const items = Array.isArray(details?.items) ? details.items : [];
  if (resourceType === 'total') return items.reduce((sum, item) => sum + Number(item.transferSize || 0), 0);
  return items
    .filter((item) => item.resourceType === resourceType)
    .reduce((sum, item) => sum + Number(item.transferSize || 0), 0);
}

function assertBudget(label, actual, minOrMax, mode, failures) {
  const ok = mode === 'min' ? actual >= minOrMax : actual <= minOrMax;
  if (!ok) failures.push(`${label}: ${actual} ${mode === 'min' ? '<' : '>'} ${minOrMax}`);
}

await fs.mkdir(outDir, { recursive: true });

const extraHeaders = {};
const vercelBypassSecret =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
  process.env.VERCEL_PROTECTION_BYPASS ||
  process.env.VERCEL_BYPASS_SECRET;
if (vercelBypassSecret) {
  extraHeaders['x-vercel-protection-bypass'] = vercelBypassSecret;
  extraHeaders['x-vercel-set-bypass-cookie'] = 'true';
}

const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
});

const failures = [];
const summaries = [];

try {
  for (const route of paths) {
    const url = urlFor(route);
    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
    }, {
      extends: 'lighthouse:default',
      settings: {
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        formFactor: 'desktop',
        screenEmulation: {
          mobile: false,
          width: 1365,
          height: 768,
          deviceScaleFactor: 1,
          disabled: false,
        },
        throttlingMethod: 'simulate',
        extraHeaders,
      },
    });
    if (!result?.lhr) throw new Error(`Lighthouse returned no report for ${url}`);

    const lhr = result.lhr;
    const key = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
    await fs.writeFile(path.join(outDir, `${key}.json`), result.report);

    const summary = {
      route,
      url,
      performance: score(lhr, 'performance'),
      accessibility: score(lhr, 'accessibility'),
      bestPractices: score(lhr, 'best-practices'),
      seo: score(lhr, 'seo'),
      totalBytes: resourceBytes(lhr, 'total'),
      scriptBytes: resourceBytes(lhr, 'script'),
    };
    summaries.push(summary);

    assertBudget(`${route} performance`, summary.performance, budgets.performance, 'min', failures);
    assertBudget(`${route} accessibility`, summary.accessibility, budgets.accessibility, 'min', failures);
    assertBudget(`${route} best-practices`, summary.bestPractices, budgets.bestPractices, 'min', failures);
    assertBudget(`${route} seo`, summary.seo, budgets.seo, 'min', failures);
    assertBudget(`${route} total transfer bytes`, summary.totalBytes, budgets.totalBytes, 'max', failures);
    assertBudget(`${route} JS transfer bytes`, summary.scriptBytes, budgets.scriptBytes, 'max', failures);
  }
} finally {
  await chrome.kill();
}

await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify({ budgets, summaries, failures }, null, 2));
console.log(JSON.stringify({ budgets, summaries, failures }, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
