import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import db from '../db';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return secret || 'condoos-dev-secret';
}

const JWT_SECRET = getJwtSecret();

export interface AuthUser {
  id: number;
  email: string;
  role: 'resident' | 'board_admin';
  condominium_id: number | null;
  first_name: string;
  last_name: string;
  unit_number: string | null;
  avatar_url: string | null;
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

export function signToken(userId: number): string {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): { uid: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { uid: number };
  } catch {
    return null;
  }
}

function loadUser(id: number): AuthUser | null {
  const row = db.prepare(
    `SELECT id, email, role, condominium_id, first_name, last_name, unit_number, avatar_url
     FROM users WHERE id = ?`
  ).get(id) as AuthUser | undefined;
  return row || null;
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
  req.user = user;
  next();
}

export function requireRole(role: AuthUser['role']) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'not_authenticated' });
    if (req.user.role !== role) {
      return res.status(403).json({ success: false, error: 'forbidden' });
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

  // Special case: a board_admin who manages the building without owning a unit
  // (e.g., a professional síndico / administradora) has no user_unit row but
  // still needs to access /board/* routes. Their condominium_id is set when
  // they create the building. Voting eligibility for AGOs is enforced
  // elsewhere via user_unit.relationship='owner', so a no-unit admin can run
  // the building but cannot vote — matching Brazilian condo law.
  if (rows.length === 0) {
    if (req.user.role === 'board_admin' && req.user.condominium_id) {
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
