import { query, withTransaction, changeCoins } from './db.js';

const PASS_DAYS = 30;

// Records a checkout before the customer is sent to the provider. `meta` says what to deliver:
// { type: 'topup', coins } or { type: 'pass', planCode }.
export async function createPendingPayment({ userId, kind, amount, currency, provider, method, description, meta }) {
  const { rows: [payment] } = await query(
    `INSERT INTO payments (user_id, kind, amount_cents, currency, provider, method, status, description, meta)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8) RETURNING *`,
    [userId, kind, amount, currency, provider, method, description, meta],
  );
  return payment;
}

export async function setProviderRef(paymentId, ref) {
  await query('UPDATE payments SET provider_ref = $2 WHERE id = $1', [paymentId, ref]);
}

export async function markFailed(paymentId) {
  await query(`UPDATE payments SET status = 'failed' WHERE id = $1 AND status = 'pending'`, [paymentId]);
}

// A non-renewing 30-day plan (bought with a wallet / QR / PayPal). Buying the same plan again
// extends it; buying another plan replaces the current pass.
async function grantPass(client, userId, planCode, currency) {
  const { rows: [plan] } = await client.query('SELECT * FROM plans WHERE code = $1', [planCode]);
  const { rows: [current] } = await client.query(
    `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active' FOR UPDATE`, [userId]);

  if (current && current.plan_id === plan.id && !current.stripe_subscription_id) {
    await client.query(
      `UPDATE subscriptions
       SET current_period_end = greatest(current_period_end, now()) + interval '${PASS_DAYS} days', cancel_at_period_end = true
       WHERE id = $1`,
      [current.id],
    );
  } else {
    if (current) await client.query(`UPDATE subscriptions SET status = 'replaced' WHERE id = $1`, [current.id]);
    await client.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, cancel_at_period_end, current_period_end, currency)
       VALUES ($1, $2, 'active', true, now() + interval '${PASS_DAYS} days', $3)`,
      [userId, plan.id, currency],
    );
  }
  await changeCoins(client, userId, plan.monthly_coins, 'subscription_bonus', `${plan.name} monthly coins`);
}

// Delivers a paid payment exactly once — safe to call from webhooks, return pages and polling at the same time.
export async function fulfillPayment(paymentId, providerRef) {
  return withTransaction(async (client) => {
    const { rows: [payment] } = await client.query(
      `UPDATE payments SET status = 'paid', provider_ref = coalesce($2, provider_ref)
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [paymentId, providerRef ?? null],
    );
    if (!payment) return false;
    const { meta } = payment;
    if (meta.type === 'topup') {
      await changeCoins(client, payment.user_id, meta.coins, 'topup', `Top up ${meta.coins.toLocaleString('en-US')} coins`);
    } else if (meta.type === 'pass') {
      await grantPass(client, payment.user_id, meta.planCode, payment.currency);
    }
    return true;
  });
}
