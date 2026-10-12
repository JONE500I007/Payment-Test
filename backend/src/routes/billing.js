import { Router } from 'express';
import { query, pool, withTransaction, changeCoins } from '../db.js';
import { requireAuth } from '../auth.js';
import { getActiveSubscription, publicSubscription } from '../subscriptions.js';
import {
  stripe, requireStripe, APP_URL, ensurePlanPrices, getOrCreateCustomer, planPrice,
  stripeLocale, syncSubscription, handleInvoicePaid, createSubscriptionCheckout,
} from '../stripe.js';
import { fulfillPayment } from '../fulfillment.js';

const router = Router();
router.use(requireAuth);

const loadSub = async (userId) => publicSubscription(await getActiveSubscription(pool, userId));
const loadPrefs = async (userId) => (await query('SELECT locale, currency FROM users WHERE id = $1', [userId])).rows[0];

router.get('/plans', async (req, res) => {
  const { rows } = await query(
    `SELECT p.*,
       (SELECT count(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active')::int AS subscribers
     FROM plans p ORDER BY rank`,
  );
  res.json({
    stripeEnabled: !!stripe,
    plans: rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      icon: p.icon,
      rank: p.rank,
      prices: { usd: p.price_cents, thb: p.price_thb },
      monthlyCoins: p.monthly_coins,
      discountPct: p.discount_pct,
      features: p.features,
      popular: p.popular,
      subscribers: p.subscribers,
    })),
  });
});

router.get('/subscription', async (req, res) => {
  res.json({ subscription: await loadSub(req.userId) });
});

// Resumes a subscription that was set to cancel at period end.
async function resume(current) {
  if (!current.stripe_subscription_id) {
    await query('UPDATE subscriptions SET cancel_at_period_end = false WHERE id = $1', [current.id]);
    return;
  }
  const sub = await stripe.subscriptions.retrieve(current.stripe_subscription_id);
  await stripe.subscriptions.update(sub.id, sub.cancel_at_period_end ? { cancel_at_period_end: false } : { cancel_at: '' });
  await syncSubscription(sub.id);
}

router.post('/subscription', requireStripe, async (req, res) => {
  const code = String(req.body.planCode ?? '');
  let { rows: [plan] } = await query('SELECT * FROM plans WHERE code = $1', [code]);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  if (!plan.stripe_price_id || !plan.stripe_price_id_thb) {
    await ensurePlanPrices();
    ({ rows: [plan] } = await query('SELECT * FROM plans WHERE code = $1', [code]));
  }

  const current = await getActiveSubscription(pool, req.userId);
  if (current?.code === code) {
    // 30-day passes don't renew; they're extended by buying again (POST /checkout).
    if (!current.stripe_subscription_id || !current.cancel_at_period_end) {
      return res.status(400).json({ error: 'You are already on this plan' });
    }
    await resume(current);
    return res.json({ subscription: await loadSub(req.userId) });
  }

  // Existing Stripe subscription: switch the price in place. Upgrades are charged the prorated
  // difference right away; if that payment fails the change is not applied.
  if (current?.stripe_subscription_id) {
    const sub = await stripe.subscriptions.retrieve(current.stripe_subscription_id);
    if (sub.cancel_at_period_end || sub.cancel_at) await resume(current);
    // A subscription can't change currency, so switch to the new plan's price in the same currency.
    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: sub.items.data[0].id, price: planPrice(plan, sub.currency).priceId }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'pending_if_incomplete',
      expand: ['latest_invoice'],
    });
    if (updated.pending_update) {
      return res.status(402).json({ error: 'Payment for the plan change failed. Update your card under Settings → Manage billing.' });
    }
    if (updated.latest_invoice?.status === 'paid') await handleInvoicePaid(updated.latest_invoice);
    else await syncSubscription(sub.id);

    const extraCoins = plan.monthly_coins - current.monthly_coins;
    if (extraCoins > 0) {
      await withTransaction((client) =>
        changeCoins(client, req.userId, extraCoins, 'subscription_bonus', `Upgrade to ${plan.name} bonus coins`));
    }
    return res.json({ subscription: await loadSub(req.userId) });
  }

  // No Stripe subscription yet: send the user to Stripe Checkout in their chosen currency.
  res.json({ url: await createSubscriptionCheckout(req.userId, plan, await loadPrefs(req.userId)) });
});

router.post('/subscription/cancel', async (req, res) => {
  const current = await getActiveSubscription(pool, req.userId);
  if (!current) return res.status(400).json({ error: 'You have no active subscription' });
  if (current.stripe_subscription_id) {
    if (!stripe) return res.status(503).json({ error: 'Payments are not configured yet' });
    await stripe.subscriptions.update(current.stripe_subscription_id, { cancel_at_period_end: true });
    await syncSubscription(current.stripe_subscription_id);
  } else {
    await query('UPDATE subscriptions SET cancel_at_period_end = true WHERE id = $1', [current.id]);
  }
  res.json({ subscription: await loadSub(req.userId) });
});

router.get('/coin-packages', async (req, res) => {
  const { rows } = await query('SELECT * FROM coin_packages ORDER BY price_cents');
  res.json({
    stripeEnabled: !!stripe,
    packages: rows.map((p) => ({ id: p.id, coins: p.coins, bonus: p.bonus, prices: { usd: p.price_cents, thb: p.price_thb } })),
  });
});

// Called by the success page so the purchase shows up immediately, even before (or without) the webhook.
// Fulfilment is idempotent, so the webhook arriving later does nothing extra.
router.post('/checkout/confirm', requireStripe, async (req, res) => {
  const sessionId = String(req.body.sessionId ?? '');
  if (!sessionId.startsWith('cs_')) return res.status(400).json({ error: 'Invalid session' });
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.metadata?.userId !== String(req.userId)) return res.status(404).json({ error: 'Session not found' });

  if (session.mode === 'payment') {
    if (session.payment_status === 'paid' && session.metadata?.paymentId) {
      await fulfillPayment(Number(session.metadata.paymentId), session.id);
    }
    return res.json({ kind: 'payment' });
  }

  if (session.subscription) {
    const sub = await stripe.subscriptions.retrieve(session.subscription, { expand: ['latest_invoice'] });
    if (sub.latest_invoice?.status === 'paid') await handleInvoicePaid(sub.latest_invoice);
    else await syncSubscription(sub.id);
  }
  res.json({ kind: 'subscription', subscription: await loadSub(req.userId) });
});

// Stripe-hosted page where the user manages cards, invoices and cancellation.
router.post('/portal', requireStripe, async (req, res) => {
  const prefs = await loadPrefs(req.userId);
  const session = await stripe.billingPortal.sessions.create({
    customer: await getOrCreateCustomer(req.userId),
    locale: stripeLocale(prefs.locale),
    return_url: `${APP_URL}/settings`,
  });
  res.json({ url: session.url });
});

router.get('/payments', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
    [req.userId],
  );
  res.json({
    payments: rows.map((p) => ({
      id: p.id, kind: p.kind, amount: p.amount_cents, currency: p.currency, provider: p.provider, method: p.method,
      status: p.status, description: p.description, createdAt: p.created_at,
    })),
  });
});

router.get('/transactions', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const { rows } = await query(
    'SELECT * FROM coin_transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
    [req.userId, limit],
  );
  res.json({
    transactions: rows.map((t) => ({
      id: t.id, type: t.type, amount: t.amount, balanceAfter: t.balance_after,
      description: t.description, createdAt: t.created_at,
    })),
  });
});

export default router;
