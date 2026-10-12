import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { query, withTransaction, changeCoins } from '../db.js';
import { setAuthCookie, clearAuthCookie, requireAuth, publicUser } from '../auth.js';

const router = Router();
const WELCOME_COINS = 100;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const USER_COLUMNS = 'id, name, email, coins, created_at, avatar_updated_at, token_version, locale, currency';
export const LOCALES = ['en', 'th'];
export const CURRENCIES = ['usd', 'thb'];

export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

router.post('/register', authLimiter, async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');
  // The sign-up page sends the language/currency the visitor was already using.
  const locale = LOCALES.includes(req.body.locale) ? req.body.locale : 'en';
  const currency = CURRENCIES.includes(req.body.currency) ? req.body.currency : 'usd';

  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const hash = await bcrypt.hash(password, 12);
  try {
    const user = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, locale, currency) VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_COLUMNS}`,
        [name, email, hash, locale, currency],
      );
      rows[0].coins = await changeCoins(client, rows[0].id, WELCOME_COINS, 'welcome', 'Welcome bonus');
      return rows[0];
    });
    setAuthCookie(res, user.id, user.token_version);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This email is already registered' });
    throw err;
  }
});

router.post('/login', authLimiter, async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');
  const { rows } = await query(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`, [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  setAuthCookie(res, user.id, user.token_version);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.userId]);
  res.json({ user: publicUser(rows[0]) });
});

export default router;
