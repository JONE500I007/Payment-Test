// Returns the user's active subscription joined with its plan, or null.
// Stripe-managed subscriptions are kept in sync by webhooks; only older local ones
// (created before Stripe was connected) expire here.
export async function getActiveSubscription(db, userId) {
  const { rows } = await db.query(
    `SELECT s.*, p.code, p.name, p.icon, p.rank, p.price_cents, p.monthly_coins, p.discount_pct, p.stripe_price_id,
            p.price_thb, p.stripe_price_id_thb
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 AND s.status = 'active'`,
    [userId],
  );
  const sub = rows[0];
  if (!sub) return null;
  if (!sub.stripe_subscription_id && new Date(sub.current_period_end) <= new Date()) {
    await db.query(`UPDATE subscriptions SET status = 'expired' WHERE id = $1`, [sub.id]);
    return null;
  }
  return sub;
}

export function publicSubscription(sub) {
  if (!sub) return null;
  return {
    id: sub.id,
    planCode: sub.code,
    planName: sub.name,
    icon: sub.icon,
    rank: sub.rank,
    discountPct: sub.discount_pct,
    monthlyCoins: sub.monthly_coins,
    currency: sub.currency,
    price: sub.currency === 'thb' ? sub.price_thb : sub.price_cents,
    startedAt: sub.started_at,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    managedByStripe: !!sub.stripe_subscription_id,
  };
}
