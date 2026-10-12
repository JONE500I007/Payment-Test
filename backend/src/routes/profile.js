import express, { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { requireAuth, setAuthCookie, clearAuthCookie, publicUser } from '../auth.js';
import { EMAIL_RE, USER_COLUMNS, LOCALES, CURRENCIES, authLimiter } from './auth.js';
import { stripe } from '../stripe.js';

const router = Router();
router.use(requireAuth);

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_MAX_BYTES = 512 * 1024;

async function checkPassword(userId, password) {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  return bcrypt.compare(String(password ?? ''), rows[0].password_hash);
}

router.patch('/', async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  const email = String(req.body.email ?? '').trim().toLowerCase();
  if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email' });

  const { rows: [current] } = await query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.userId]);
  if (email !== current.email && !(await checkPassword(req.userId, req.body.currentPassword))) {
    return res.status(400).json({ error: 'Enter your current password to change your email' });
  }

  try {
    const { rows: [user] } = await query(
      `UPDATE users SET name = $2, email = $3 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [req.userId, name, email],
    );
    // Keep receipts going to the right address.
    if (stripe && current.stripe_customer_id) {
      await stripe.customers.update(current.stripe_customer_id, { name, email }).catch((err) =>
        console.warn('Could not update Stripe customer:', err.message));
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'This email is already registered' });
    throw err;
  }
});

router.patch('/preferences', async (req, res) => {
  const { locale, currency } = req.body;
  if (locale !== undefined && !LOCALES.includes(locale)) return res.status(400).json({ error: 'Unsupported language' });
  if (currency !== undefined && !CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Unsupported currency' });
  const { rows: [user] } = await query(
    `UPDATE users SET locale = coalesce($2, locale), currency = coalesce($3, currency)
     WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [req.userId, locale ?? null, currency ?? null],
  );
  res.json({ user: publicUser(user) });
});

router.post('/password', authLimiter, async (req, res) => {
  const newPassword = String(req.body.newPassword ?? '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (!(await checkPassword(req.userId, req.body.currentPassword))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  const hash = await bcrypt.hash(newPassword, 12);
  const { rows: [user] } = await query(
    `UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING token_version`,
    [req.userId, hash],
  );
  // Other devices are signed out; this one gets a fresh cookie.
  setAuthCookie(res, req.userId, user.token_version);
  res.json({ ok: true });
});

router.get('/avatar', async (req, res) => {
  const { rows: [user] } = await query('SELECT avatar, avatar_mime FROM users WHERE id = $1', [req.userId]);
  if (!user?.avatar) return res.status(404).end();
  res.set('Content-Type', user.avatar_mime);
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(user.avatar);
});

// Body is the raw image (the browser crops and resizes it to 256px first).
router.put('/avatar', express.raw({ type: AVATAR_TYPES, limit: AVATAR_MAX_BYTES }), async (req, res) => {
  const mime = req.get('Content-Type');
  if (!AVATAR_TYPES.includes(mime) || !Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: 'Upload a JPEG, PNG or WebP image' });
  }
  const { rows: [user] } = await query(
    `UPDATE users SET avatar = $2, avatar_mime = $3, avatar_updated_at = now() WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [req.userId, req.body, mime],
  );
  res.json({ user: publicUser(user) });
});

router.delete('/avatar', async (req, res) => {
  const { rows: [user] } = await query(
    `UPDATE users SET avatar = NULL, avatar_mime = NULL, avatar_updated_at = NULL WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [req.userId],
  );
  res.json({ user: publicUser(user) });
});

router.delete('/', authLimiter, async (req, res) => {
  if (!(await checkPassword(req.userId, req.body?.password))) {
    return res.status(400).json({ error: 'Password is incorrect' });
  }
  // Stop future charges before the account disappears.
  const { rows: subs } = await query(
    `SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND status = 'active' AND stripe_subscription_id IS NOT NULL`,
    [req.userId],
  );
  for (const { stripe_subscription_id: id } of subs) {
    if (!stripe) return res.status(503).json({ error: 'Cannot cancel your subscription right now. Try again later.' });
    await stripe.subscriptions.cancel(id);
  }
  await query('DELETE FROM users WHERE id = $1', [req.userId]);
  clearAuthCookie(res);
  res.json({ ok: true });
});

export default router;
