import express from 'express';
import cookieParser from 'cookie-parser';
import { migrate } from './schema.js';
import { stripe, ensurePlanPrices } from './stripe.js';
import authRoutes from './routes/auth.js';
import billingRoutes from './routes/billing.js';
import shopRoutes from './routes/shop.js';
import profileRoutes from './routes/profile.js';
import webhookRoutes from './routes/webhook.js';
import checkoutRoutes from './routes/checkout.js';
import omiseWebhookRoutes from './routes/omiseWebhook.js';
import { omiseEnabled } from './omise.js';
import { paypalEnabled } from './paypal.js';

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');

const app = express();
app.set('trust proxy', 1);
app.use('/api/stripe/webhook', webhookRoutes); // raw body — must come before express.json()
app.use('/api/omise/webhook', omiseWebhookRoutes);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true, stripe: !!stripe, omise: omiseEnabled, paypal: paypalEnabled }));
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/billing', checkoutRoutes);
app.use('/api/shop', shopRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  // Stripe client errors (bad card, invalid request) are safe to show; anything else is logged.
  if (err.type?.startsWith('Stripe') && err.statusCode && err.statusCode < 500) {
    console.warn('Stripe error:', err.message);
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

// Postgres may still be starting when the container boots, so retry the migration briefly.
for (let attempt = 1; ; attempt++) {
  try {
    await migrate();
    break;
  } catch (err) {
    if (attempt >= 10) throw err;
    console.log(`Database not ready (${err.code ?? err.message}), retrying...`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

if (stripe) {
  await ensurePlanPrices().then(
    () => console.log('Stripe connected, plan prices ready'),
    (err) => console.error('Stripe setup failed:', err.message),
  );
} else {
  console.log('STRIPE_SECRET_KEY not set — payments are disabled');
}

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`API listening on :${port}`));
