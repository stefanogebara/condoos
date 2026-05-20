import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import db from '../db';
import { agencyUserCanUseBuildingCapability, type AgencyBuildingCapability } from './agencies';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET is required in production');
    }
    // Generate a per-process random secret for dev/test instead of using a
    // known shared fallback. Tokens issued by one dev process won't validate
    // in another, which is acceptable — and there is no shipped secret to
    // forge with if the .env is misconfigured.
    return randomBytes(32).toString('hex');
  }
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

export interface AuthUser {
  id: number;
  email: string;
  role: 'resident' | 'board_admin' | 'concierge';
  condominium_id: number | null;
  first_name: string;
  last_name: string;
  unit_number: string | null;
  avatar_url: string | null;
  mobile_phone?: string | null;
  home_phone?: string | null;
  email_verified_at?: string | null;
}

interface StoredAuthUser extends AuthUser {
  token_version: number;
}

interface TokenPayload {
  uid: number;
  token_version?: number;
}

export interface ActiveMembership {
  user_unit_id: number;
  unit_id: number;
  condominium_id: number;
  relationship: 'owner' | 'tenant' | 'occupant';
  primary_contact: number;
  voting_weight: number;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  memberships?: ActiveMembership[];   // populated by requireActiveMembership
}

function currentTokenVersion(userId: number): number {
  const row = db.prepare(
    `SELECT COALESCE(token_version, 0) AS token_version FROM users WHERE id = ?`
  ).get(userId) as { token_version: number } | undefined;
  return Number(row?.token_version || 0);
}

export function signToken(userId: number): string {
  return jwt.sign({ uid: userId, token_version: currentTokenVersion(userId) }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    // Pin algorithm to HS256 — defense-in-depth against future jsonwebtoken
    // changes that might re-allow algorithm confusion via a forged header.
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
    if (!Number.isInteger(payload.uid) || payload.uid <= 0) return null;
    return payload;
  } catch {
    return null;
  }
}

function loadUser(id: number): StoredAuthUser | null {
  const row = db.prepare(
    `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, avatar_url,
            mobile_phone, home_phone, email_verified_at,
            COALESCE(token_version, 0) AS token_version
     FROM users WHERE id = ?`
  ).get(id) as StoredAuthUser | undefined;
  return row || null;
}

export function revokeUserTokens(userId: number): void {
  db.prepare(
    `UPDATE users
     SET token_version = COALESCE(token_version, 0) + 1
     WHERE id = ?`
  ).run(userId);
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'missing_token' });
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) return res.status(401).json({ success: false, error: 'invalid_token' });
  const user = loadUser(payload.uid);
  if (!user) return res.status(401).json({ success: false, error: 'user_not_found' });
  const tokenVersion = Number(payload.token_version ?? 0);
  if (tokenVersion !== Number(user.token_version || 0)) {
    return res.status(401).json({ success: false, error: 'invalid_token_version' });
  }
  const { token_version, ...publicUser } = user;
  req.user = publicUser;
  next();
}

export function requireRole(...roles: AuthUser['role'][]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'not_authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'forbidden' });
    }
    next();
  };
}

export function requireBoardCapability(capability: AgencyBuildingCapability) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'not_authenticated' });
    if (req.user.role !== 'board_admin') return next();

    let condoId: number;
    try {
      condoId = getActiveCondoId(req);
    } catch {
      return res.status(403).json({ success: false, error: 'no_active_membership' });
    }

    const access = agencyUserCanUseBuildingCapability(req.user.id, condoId, capability);
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        error: 'agency_capability_forbidden',
        required_capability: capability,
      });
    }
    next();
  };
}

/**
 * Verify the authenticated user has at least one active user_unit row,
 * auto-correct their users.condominium_id if it points at a condo where they
 * have no active membership (keeps legacy cached fields coherent), and expose
 * the full set of active memberships as req.memberships.
 *
 * Use on every data route that is scoped by condominium_id.
 */
export function requireActiveMembership(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, error: 'not_authenticated' });
  const rows = db.prepare(
    `SELECT uu.id AS user_unit_id, uu.unit_id, uu.relationship, uu.primary_contact, uu.voting_weight,
            b.condominium_id
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.user_id = ? AND uu.status = 'active'`
  ).all(req.user.id) as ActiveMembership[];

  // Special case: staff who run the building without owning a unit. Either
  // a professional síndico / administradora (board_admin) or a porteiro
  // (concierge). Both have users.condominium_id set but no user_unit row.
  // Voting eligibility in AGOs is gated separately via user_unit.relationship,
  // so no-unit staff can run the building but cannot vote — matching law.
  if (rows.length === 0) {
    const isStaff = req.user.role === 'board_admin' || req.user.role === 'concierge';
    if (isStaff && req.user.condominium_id) {
      req.memberships = [];
      return next();
    }
    return res.status(403).json({ success: false, error: 'no_active_membership' });
  }

  // Auto-correct stale users.condominium_id.
  const currentCondoHasMembership = rows.some((r) => r.condominium_id === req.user!.condominium_id);
  if (!currentCondoHasMembership) {
    db.prepare(`UPDATE users SET condominium_id = ? WHERE id = ?`).run(
      rows[0].condominium_id,
      req.user.id,
    );
    req.user.condominium_id = rows[0].condominium_id;
  }

  req.memberships = rows;
  next();
}

export function getActiveCondoId(req: AuthedRequest): number {
  const condoId = req.user?.condominium_id ?? req.memberships?.[0]?.condominium_id;
  if (!condoId) {
    const err = new Error('no_active_membership') as Error & { status?: number };
    err.status = 403;
    throw err;
  }
  return condoId;
}
