import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import db from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'condoos-dev-secret';

export interface AuthUser {
  id: number;
  email: string;
  role: 'resident' | 'board_admin';
  condominium_id: number;
  first_name: string;
  last_name: string;
  unit_number: string | null;
  avatar_url: string | null;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
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
