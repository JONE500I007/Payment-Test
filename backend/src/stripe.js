import Stripe from 'stripe';
import { query, withTransaction, changeCoins } from './db.js';
import { fulfillPayment } from './fulfillment.js';

export const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
export const CURRENCIES = ['usd', 'thb'];
export const APP_URL = process.env.APP_URL || 'http://localhost:5180';

export function requireStripe(req, res, next) {
  if (!stripe) return res.status(503).json({ error: 'Payments are not configured yet (STRIPE_SECRET_KEY missing)' });
  next();
}

// Stripe subscription status -> our status. 'incomplete' is skipped until the first payment succeeds.
const STATUS = {
  active: 'active', trialing: 'active', past_due: 'active',
  canceled: 'expired', unpaid: 'expired', incomplete_expired: 'expired', paused: 'expired',
};

// Amount (minor units) and Stripe Price id of a plan or coin package in the given currency.
export function planPrice(plan, currency) {
  return currency === 'thb'
    ? { amount: plan.price_thb, priceId: plan.stripe_price_id_thb }
    : { amount: plan.price_cents, priceId: plan.stripe_price_id };
}
export const packagePrice = (pkg, currency) => (currency === 'thb' ? pkg.price_thb : pkg.price_cents);

// Stripe-hosted pages (Checkout, billing portal) in the user's language.
export const stripeLocale = (locale) => (locale === 'th' ? 'th' : 'en');

// Creates one recurring Price per plan and currency (found again by lookup_key) so plan
// switches can reference it.
export async function ensurePlanPrices() {
  if (!stripe) return;
  const { rows: plans } = await query('SELECT * FROM plans ORDER BY rank');
  for (const plan of plans) {
    for (const currency of CURRENCIES) {
      const { amount } = planPrice(plan, currency);
      const lookupKey = `coinly_plan_${plan.code}_${amount}_${currency}`;
      const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
      const price = existing.data[0] ?? await stripe.prices.create({
        currency,
        unit_amount: amount,
        recurring: { interval: 'month' },
        lookup_key: lookupKey,
        product_data: { name: `Coinly ${plan.name} plan` },
      });
      const column = currency === 'thb' ? 'stripe_price_id_thb' : 'stripe_price_id';
      await query(`UPDATE plans SET ${column} = $2 WHERE id = $1`, [plan.id, price.id]);
    }
  }
}

export async function getOrCreateCustomer(userId) {
  const { rows: [user] } = await query('SELECT id, name, email, stripe_customer_id FROM users WHERE id = $1', [userId]);
  if (user.stripe_customer_id) {
    // The id may belong to the other mode (test vs live) or have been deleted in the dashboard.
    const existing = await stripe.customers.retrieve(user.stripe_customer_id).catch(() => null);
    if (existing && !existing.deleted) return existing.id;
  }
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId: String(user.id) },
  });
  await query('UPDATE users SET stripe_customer_id = $2 WHERE id = $1', [user.id, customer.id]);
  return customer.id;
}

async function userIdForCustomer(customerId) {
  const { rows } = await query('SELECT id FROM users WHERE stripe_customer_id = $1', [customerId]);
  return rows[0]?.id ?? null;
}

// Mirrors a Stripe subscription into our subscriptions table. Always re-fetches so stale
// or out-of-order webhook payloads can't overwrite newer state.
export async function syncSubscription(subscriptionId) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const status = STATUS[sub.status];
  if (!status) return null;
  const item = sub.items.data[0];
  const userId = await userIdForCustomer(sub.customer);
  const { rows: [plan] } = await query(
    'SELECT * FROM plans WHERE stripe_price_id = $1 OR stripe_price_id_thb = $1', [item.price.id]);
  if (!userId || !plan) {
    console.warn(`Stripe subscription ${sub.id}: unknown customer or price, skipped`);
    return null;
  }
  return withTransaction(async (client) => {
    if (status === 'active') {
      await client.query(
        `UPDATE subscriptions SET status = 'replaced'
         WHERE user_id = $1 AND status = 'active' AND stripe_subscription_id IS DISTINCT FROM $2`,
        [userId, sub.id],
      );
    }
    await client.query(
      `INSERT INTO subscriptions
         (user_id, plan_id, status, cancel_at_period_end, started_at, current_period_end, stripe_subscription_id, currency)
       VALUES ($1, $2, $3, $4, to_timestamp($5), to_timestamp($6), $7, $8)
       ON CONFLICT (stripe_subscription_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, status = EXCLUDED.status,
         cancel_at_period_end = EXCLUDED.cancel_at_period_end, current_period_end = EXCLUDED.current_period_end`,
      [userId, plan.id, status, sub.cancel_at_period_end || !!sub.cancel_at, sub.start_date,
        item.current_period_end, sub.id, sub.currency],
    );
    return { userId, plan, status };
  });
}

// Records a paid subscription invoice once, and grants the plan's monthly coins for
// new subscriptions and renewals (not for mid-period plan changes).
export async function handleInvoicePaid(invoice) {
  const subscriptionId = invoice.parent?.subscription_details?.subscription;
  if (!subscriptionId) return;
  const synced = await syncSubscription(typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id);
  if (!synced) return;
  const { userId, plan } = synced;
  const grantsCoins = ['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason);
  const description = invoice.billing_reason === 'subscription_cycle' ? `${plan.name} plan renewal`
    : invoice.billing_reason === 'subscription_update' ? `${plan.name} plan change`
    : `${plan.name} plan subscription`;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO payments (user_id, kind, amount_cents, currency, provider, status, description, stripe_ref)
       VALUES ($1, 'subscription', $2, $3, 'stripe', 'paid', $4, $5)
       ON CONFLICT (stripe_ref) DO NOTHING RETURNING id`,
      [userId, invoice.amount_paid, invoice.currency, description, invoice.id],
    );
    if (rows.length && grantsCoins) {
      await changeCoins(client, userId, plan.monthly_coins, 'subscription_bonus', `${plan.name} monthly coins`);
    }
  });
}

// Recurring card subscription via Stripe Checkout; returns the URL to send the customer to.
export async function createSubscriptionCheckout(userId, plan, prefs) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: await getOrCreateCustomer(userId),
    locale: stripeLocale(prefs.locale),
    allowed_payment_method_types: ['card'],
    line_items: [{ price: planPrice(plan, prefs.currency).priceId, quantity: 1 }],
    client_reference_id: String(userId),
    metadata: { userId: String(userId), kind: 'subscription', planCode: plan.code },
    subscription_data: { metadata: { userId: String(userId) } },
    success_url: `${APP_URL}/plans?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/plans?checkout=cancel`,
  });
  return session.url;
}

// One-time Stripe Checkout (card or PromptPay) for a pending payment row.
export async function createPaymentCheckout({ userId, payment, method, locale }) {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: await getOrCreateCustomer(userId),
    locale: stripeLocale(locale),
    allowed_payment_method_types: [method === 'promptpay' ? 'promptpay' : 'card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: payment.currency,
        unit_amount: payment.amount_cents,
        product_data: { name: `Coinly — ${payment.description}` },
      },
    }],
    client_reference_id: String(userId),
    metadata: { userId: String(userId), paymentId: String(payment.id) },
    success_url: `${APP_URL}/payment/return?pid=${payment.id}`,
    cancel_url: `${APP_URL}/payment/return?pid=${payment.id}&canceled=1`,
  });
  return session;
}

// 'paid' | 'pending' | 'failed' for a payment-mode Checkout session.
export async function checkoutSessionStatus(sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status === 'paid') return 'paid';
  if (session.status === 'expired') return 'failed';
  return 'pending';
}

export async function handleWebhookEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (obj.mode === 'payment' && obj.payment_status === 'paid' && obj.metadata?.paymentId) {
        await fulfillPayment(Number(obj.metadata.paymentId), obj.id);
      }
      else if (obj.mode === 'subscription' && obj.subscription) await syncSubscription(obj.subscription);
      break;
    case 'invoice.paid':
      // Event payloads use the account's default API version; re-fetch so the shape matches the SDK's.
      await handleInvoicePaid(await stripe.invoices.retrieve(obj.id));
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(obj.id);
      break;
  }
}

