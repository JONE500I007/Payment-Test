import jwt from 'jsonwebtoken';
import { query } from './db.js';

const COOKIE = 'token';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// `version` is users.token_version; bumping it (e.g. on password change) signs out every other session.
export function setAuthCookie(res, userId, version = 0) {
  const token = jwt.sign({ sub: userId, ver: version }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE);
}

export async function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    clearAuthCookie(res);
    return res.status(401).json({ error: 'Session expired' });
  }
  const { rows } = await query('SELECT token_version FROM users WHERE id = $1', [payload.sub]);
  if (!rows.length || rows[0].token_version !== (payload.ver ?? 0)) {
    clearAuthCookie(res);
    return res.status(401).json({ error: 'Session expired' });
  }
  req.userId = Number(payload.sub);
  next();
}

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  coins: u.coins,
  createdAt: u.created_at,
  locale: u.locale,
  currency: u.currency,
  avatarUrl: u.avatar_updated_at ? `/api/profile/avatar?v=${new Date(u.avatar_updated_at).getTime()}` : null,
});
