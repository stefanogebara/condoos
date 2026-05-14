import * as dotenv from 'dotenv';
import path from 'path';
// Load root .env (shared with client), then allow server/.env to override.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { requireAuth, requireActiveMembership } from './lib/auth';
import { startVoteCloser } from './lib/vote-closer';
import { startSlaEscalator } from './lib/sla-escalator';
import { getWhatsAppHealth, getWhatsAppStatus } from './lib/whatsapp';
import { captureException, initSentry } from './lib/sentry';
import authRoutes from './routes/auth';
import packagesRoutes from './routes/packages';
import visitorsRoutes from './routes/visitors';
import amenitiesRoutes from './routes/amenities';
import announcementsRoutes from './routes/announcements';
import suggestionsRoutes from './routes/suggestions';
import proposalsRoutes from './routes/proposals';
import meetingsRoutes from './routes/meetings';
import usersRoutes from './routes/users';
import aiRoutes from './routes/ai';
import onboardingRoutes from './routes/onboarding';
import membershipsRoutes from './routes/memberships';
import assembliesRoutes from './routes/assemblies';
import meRoutes from './routes/me';
import auditRoutes from './routes/audit';
import buildingsRoutes from './routes/buildings';
import unitsRoutes from './routes/units';
import conciergeRoutes from './routes/concierge';
import financeRoutes from './routes/finance';
import ticketsRoutes from './routes/tickets';
import documentsRoutes from './routes/documents';
import memoryRoutes from './routes/memory';
import reportsRoutes from './routes/reports';
import dashboardRoutes from './routes/dashboard';
import notificationsRoutes from './routes/notifications';
import uploadsRoutes from './routes/uploads';
import webhooksRoutes from './routes/webhooks';
import vendorPortalRoutes from './routes/vendor-portal';
import serviceContactsRoutes from './routes/service-contacts';
import { processWhatsAppOutbox } from './lib/whatsapp';
import { startScheduledInvoiceGenerator } from './lib/finance';

initSentry();
const app = express();
const PORT = Number(process.env.PORT || 4000);
// Audit M8 — trust the full proxy chain. Fly.io sets x-forwarded-for to
// the real client IP, but at the edge can chain through more than one
// internal hop. With trust proxy = 1 (single hop) req.ip occasionally
// resolved to a Fly internal address, which would collapse all per-IP
// rate-limit buckets onto a single key. trust proxy = true tells Express
// to take the leftmost x-forwarded-for entry, which is the real client.
app.set('trust proxy', true);
// Audit M10 — strip the `X-Powered-By: Express` fingerprint so attackers
// can't trivially identify the stack from response headers.
app.disable('x-powered-by');
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  credentials: true,
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production') return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // Disallowed origin: tell cors to omit ACAO headers (browser blocks the
    // response) instead of throwing into the error handler, which produced 500s
    // on every preflight from an unlisted Origin.
    return cb(null, false);
  },
}));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Audit M9 — the API only serves JSON; no scripts, no styles, no embeds.
  // A locked-down CSP costs nothing and removes a class of future XSS-via-
  // error-page or content-sniffing attack vectors.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});
app.use(express.json({ limit: '2mb' }));
// Vendor portal posts a form (no JSON) so we need urlencoded parsing
// on that route. Tight limit — vendors are filling a 4-field form.
app.use('/api/v', express.urlencoded({ extended: false, limit: '32kb' }));
// Audit M4 — body-parser surfaces JSON syntax errors with the raw V8
// message ("Expected property name or '}' in JSON at position 1"), which
// breaks the {error: <stable_code>} contract every other endpoint follows.
// Catch the parse failure here and return a stable code so clients can
// branch on it deterministically.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'invalid_json' });
  }
  return next(err);
});
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  // Audit L3 + M-N11 — health was previously truthful only about the
  // express layer. A stuck DB / corrupt SQLite file would still return
  // ok:true, masking a real outage from Fly health checks. Touch the DB
  // and surface the result in the body so external monitors / synthetic
  // probes can alert on the DB-down case without needing to parse the
  // status code.
  let dbOk = false;
  try {
    const dbModule = require('./db');
    const handle = dbModule.default || dbModule;
    handle.prepare('SELECT 1').get();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const body = {
    ok: dbOk,
    service: 'condoos-api',
    db: dbOk ? 'ok' : 'down',
    ts: new Date().toISOString(),
  };
  if (!dbOk) return res.status(503).json(body);
  res.json(body);
});

// Pre-auth / onboarding routes — no active-membership gate (users here may
// not have claimed a unit yet).
app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/me', meRoutes);
// Inbound webhooks — public endpoints (no requireAuth). Each handler
// verifies its provider's signature / shared secret before mutating state.
app.use('/api/webhooks', webhooksRoutes);
// Vendor self-service portal — public (no requireAuth). HMAC token in
// the URL gates each request to a single dispatch.
app.use('/api/v', vendorPortalRoutes);

// All real data routes require an active user_unit membership.
const scoped = [requireAuth, requireActiveMembership];
app.use('/api/packages',      scoped, packagesRoutes);
app.use('/api/visitors',      scoped, visitorsRoutes);
app.use('/api/amenities',     scoped, amenitiesRoutes);
app.use('/api/announcements', scoped, announcementsRoutes);
app.use('/api/suggestions',   scoped, suggestionsRoutes);
app.use('/api/proposals',     scoped, proposalsRoutes);
app.use('/api/meetings',      scoped, meetingsRoutes);
app.use('/api/users',         scoped, usersRoutes);
app.use('/api/ai',            scoped, aiRoutes);
app.use('/api/memberships',   scoped, membershipsRoutes);
app.use('/api/assemblies',    scoped, assembliesRoutes);
app.use('/api/audit',         scoped, auditRoutes);
app.use('/api/buildings',     scoped, buildingsRoutes);
app.use('/api/units',         scoped, unitsRoutes);
app.use('/api/concierge',     scoped, conciergeRoutes);
app.use('/api/finance',       scoped, financeRoutes);
app.use('/api/tickets',       scoped, ticketsRoutes);
app.use('/api/documents',     scoped, documentsRoutes);
app.use('/api/memory',        scoped, memoryRoutes);
app.use('/api/reports',       scoped, reportsRoutes);
app.use('/api/dashboard',     scoped, dashboardRoutes);
app.use('/api/notifications', scoped, notificationsRoutes);
app.use('/api/uploads',       scoped, uploadsRoutes);
app.use('/api/service-contacts', scoped, serviceContactsRoutes);

// 404
app.use((req, res) => res.status(404).json({ success: false, error: 'not_found', path: req.path }));

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[err]', err);
  captureException(err);
  const status = err.status || 500;
  const error = status >= 500 && process.env.NODE_ENV === 'production'
    ? 'internal_error'
    : (err.message || 'internal_error');
  res.status(status).json({ success: false, error });
});

app.listen(PORT, () => {
  console.log(`CondoOS API listening on http://localhost:${PORT}`);
  // Auto-close proposals whose voting window has expired. 60s cadence is fine —
  // worst case a vote lands 1 minute late, which is acceptable for a 24h+ window.
  if (process.env.NODE_ENV !== 'test') {
    startVoteCloser(60_000);
    startScheduledInvoiceGenerator();
    setInterval(() => {
      processWhatsAppOutbox({ limit: 25 }).catch((err) => console.warn('[notification-outbox] retry failed:', err?.message || err));
    }, 60_000);
    // 5min cadence — SLAs are measured in hours, so the worst-case escalation
    // delay is one interval. Cheaper than 60s on Fly's GB-hour billing while
    // still well under the smallest (urgent=2h) window.
    startSlaEscalator(5 * 60_000);
    console.log('[vote-closer] started (60s interval)');
    console.log('[finance] scheduled invoice generator started (6h interval)');
    console.log('[notification-outbox] retry loop started (60s interval)');
    console.log('[sla-escalator] started (5min interval)');
    // Boot-time WhatsApp health probe. Fire-and-forget — we want the
    // server up regardless, but admins should see a clear log line if
    // the provider isn't reachable so they don't wonder why messages
    // queue forever in prod.
    const cfg = getWhatsAppStatus();
    if (!cfg.configured) {
      console.warn('[whatsapp] not configured — outbox rows will queue and skip');
    } else {
      void getWhatsAppHealth(true).then((h) => {
        if (h.reachable) {
          console.log(`[whatsapp] ${cfg.provider} reachable — sending from ${h.me_phone || cfg.from || 'unknown'} (${h.me_name || h.session_status || 'ready'})`);
        } else {
          console.warn(`[whatsapp] ${cfg.provider} NOT REACHABLE: ${h.error || 'unknown error'}. Outreach sends will fail until the session is restored.`);
        }
      }).catch((err) => console.warn('[whatsapp] health probe failed:', err?.message || err));
    }
  }
});
