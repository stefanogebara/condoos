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

const app = express();
const PORT = Number(process.env.PORT || 4000);
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
    return cb(new Error('cors_origin_not_allowed'));
  },
}));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'condoos-api', ts: new Date().toISOString() });
});

// Pre-auth / onboarding routes — no active-membership gate (users here may
// not have claimed a unit yet).
app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);

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

// 404
app.use((req, res) => res.status(404).json({ success: false, error: 'not_found', path: req.path }));

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[err]', err);
  res.status(err.status || 500).json({ success: false, error: err.message || 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`CondoOS API listening on http://localhost:${PORT}`);
  // Auto-close proposals whose voting window has expired. 60s cadence is fine —
  // worst case a vote lands 1 minute late, which is acceptable for a 24h+ window.
  if (process.env.NODE_ENV !== 'test') {
    startVoteCloser(60_000);
    console.log('[vote-closer] started (60s interval)');
  }
});
