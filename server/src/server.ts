import * as dotenv from 'dotenv';
import path from 'path';
// Load root .env (shared with client), then allow server/.env to override.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

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

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'condoos-api', ts: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/packages', packagesRoutes);
app.use('/api/visitors', visitorsRoutes);
app.use('/api/amenities', amenitiesRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/suggestions', suggestionsRoutes);
app.use('/api/proposals', proposalsRoutes);
app.use('/api/meetings', meetingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/memberships', membershipsRoutes);

// 404
app.use((req, res) => res.status(404).json({ success: false, error: 'not_found', path: req.path }));

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[err]', err);
  res.status(err.status || 500).json({ success: false, error: err.message || 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`CondoOS API listening on http://localhost:${PORT}`);
});
