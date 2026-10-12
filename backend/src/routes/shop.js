import { Router } from 'express';
import { query, withTransaction, changeCoins } from '../db.js';
import { requireAuth } from '../auth.js';
import { getActiveSubscription } from '../subscriptions.js';

const router = Router();
router.use(requireAuth);

const discounted = (price, pct) => Math.round(price * (100 - pct) / 100);

router.get('/items', async (req, res) => {
  const sub = await withTransaction((client) => getActiveSubscription(client, req.userId));
  const discountPct = sub?.discount_pct ?? 0;
  const rank = sub?.rank ?? 0;
  const { rows } = await query(
    `SELECT i.*, req.name AS required_plan, pu.id IS NOT NULL AS owned
     FROM items i
     LEFT JOIN plans req ON req.rank = i.min_plan_rank
     LEFT JOIN purchases pu ON pu.item_id = i.id AND pu.user_id = $1
     ORDER BY i.min_plan_rank, i.price_coins`,
    [req.userId],
  );
  res.json({
    discountPct,
    items: rows.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      icon: i.icon,
      category: i.category,
      priceCoins: i.price_coins,
      finalPrice: discounted(i.price_coins, discountPct),
      requiredPlan: i.min_plan_rank > 0 ? i.required_plan : null,
      locked: i.min_plan_rank > rank,
      owned: i.owned,
    })),
  });
});

router.post('/items/:id/buy', async (req, res) => {
  const itemId = Number(req.params.id);
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM items WHERE id = $1', [itemId]);
    const item = rows[0];
    if (!item) return { status: 404, error: 'Item not found' };

    const sub = await getActiveSubscription(client, req.userId);
    if (item.min_plan_rank > (sub?.rank ?? 0)) {
      return { status: 403, error: 'Your plan does not include this item' };
    }
    const price = discounted(item.price_coins, sub?.discount_pct ?? 0);
    const inserted = await client.query(
      `INSERT INTO purchases (user_id, item_id, price_paid) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, item_id) DO NOTHING RETURNING id`,
      [req.userId, itemId, price],
    );
    if (!inserted.rows.length) return { status: 400, error: 'You already own this item' };
    const coins = await changeCoins(client, req.userId, -price, 'purchase', `Bought ${item.name}`);
    return { coins, price };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

router.get('/inventory', async (req, res) => {
  const { rows } = await query(
    `SELECT pu.id, pu.price_paid, pu.created_at, i.name, i.description, i.icon, i.category
     FROM purchases pu JOIN items i ON i.id = pu.item_id
     WHERE pu.user_id = $1 ORDER BY pu.created_at DESC`,
    [req.userId],
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id, name: r.name, description: r.description, icon: r.icon,
      category: r.category, pricePaid: r.price_paid, createdAt: r.created_at,
    })),
  });
});

router.get('/overview', async (req, res) => {
  const sub = await withTransaction((client) => getActiveSubscription(client, req.userId));
  const [{ rows: [user] }, { rows: [stats] }, { rows: recent }] = await Promise.all([
    query('SELECT coins FROM users WHERE id = $1', [req.userId]),
    query(
      `SELECT
         (SELECT count(*) FROM purchases WHERE user_id = $1)::int AS items_owned,
         (SELECT coalesce(sum(-amount), 0) FROM coin_transactions WHERE user_id = $1 AND type = 'purchase')::int AS coins_spent,
         (SELECT coalesce(json_agg(t), '[]') FROM (
            SELECT currency, sum(amount_cents)::int AS amount FROM payments WHERE user_id = $1 GROUP BY currency
          ) t) AS total_paid`,
      [req.userId],
    ),
    query(
      'SELECT * FROM coin_transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 6',
      [req.userId],
    ),
  ]);
  res.json({
    coins: user.coins,
    plan: sub ? { name: sub.name, icon: sub.icon, discountPct: sub.discount_pct, currentPeriodEnd: sub.current_period_end, cancelAtPeriodEnd: sub.cancel_at_period_end } : null,
    itemsOwned: stats.items_owned,
    coinsSpent: stats.coins_spent,
    totalPaid: stats.total_paid,
    recent: recent.map((t) => ({
      id: t.id, type: t.type, amount: t.amount, balanceAfter: t.balance_after,
      description: t.description, createdAt: t.created_at,
    })),
  });
});

export default router;
