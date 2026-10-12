import { Router } from 'express';
import { query, pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { getActiveSubscription, publicSubscription } from '../subscriptions.js';
import {
  stripe, APP_URL, ensurePlanPrices, planPrice, packagePrice, createSubscriptionCheckout,
  createPaymentCheckout, checkoutSessionStatus,
} from '../stripe.js';
import { omiseEnabled, createCharge, chargeStatus, chargeQrImage } from '../omise.js';
import { paypalEnabled, createOrder, captureOrder } from '../paypal.js';
import { createPendingPayment, setProviderRef, fulfillPayment, markFailed } from '../fulfillment.js';

const router = Router();
router.use(requireAuth);

// Every way to pay, in display order. `group` drives the sections of the picker;
// `recurring` = can auto-renew a plan (the rest buy a 30-day pass).
const METHODS = [
  { id: 'promptpay', group: 'qr', provider: 'stripe', currencies: ['thb'] },
  { id: 'truemoney_qr', group: 'qr', provider: 'omise', currencies: ['thb'] },
  { id: 'card', group: 'card', provider: 'stripe', currencies: ['usd', 'thb'], recurring: true },
  { id: 'truemoney', group: 'wallet', provider: 'omise', currencies: ['thb'] },
  { id: 'shopeepay', group: 'wallet', provider: 'omise', currencies: ['thb'] },
  { id: 'linepay', group: 'wallet', provider: 'omise', currencies: ['thb'] },
  { id: 'mobile_banking_kbank', group: 'bank', provider: 'omise', currencies: ['thb'] },
  { id: 'mobile_banking_scb', group: 'bank', provider: 'omise', currencies: ['thb'] },
  { id: 'mobile_banking_bay', group: 'bank', provider: 'omise', currencies: ['thb'] },
  { id: 'mobile_banking_bbl', group: 'bank', provider: 'omise', currencies: ['thb'] },
  { id: 'mobile_banking_ktb', group: 'bank', provider: 'omise', currencies: ['thb'] },
  { id: 'paypal', group: 'global', provider: 'paypal', currencies: ['usd', 'thb'] },
  { id: 'alipay', group: 'global', provider: 'omise', currencies: ['thb'] },
];

const providerEnabled = { stripe: () => !!stripe, omise: () => omiseEnabled, paypal: () => paypalEnabled };
const availableMethods = () => METHODS.filter((m) => providerEnabled[m.provider]());

router.get('/methods', (req, res) => {
  res.json({ methods: availableMethods() });
});

// Starts a payment with the chosen method. Responds with { url } to redirect to, or
// { paymentId, qrImage } when the customer pays by scanning a QR code here.
router.post('/checkout', async (req, res) => {
  const { purpose, method } = req.body;
  const def = availableMethods().find((m) => m.id === method);
  if (!def) return res.status(400).json({ error: 'This payment method is not available' });

  const { rows: [prefs] } = await query('SELECT locale, currency FROM users WHERE id = $1', [req.userId]);
  const { currency, locale } = prefs;
  if (!def.currencies.includes(currency)) {
    return res.status(400).json({ error: 'This payment method is not available in your currency' });
  }

  let order;
  if (purpose === 'topup') {
    const { rows: [pkg] } = await query('SELECT * FROM coin_packages WHERE id = $1', [Number(req.body.packageId)]);
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    const coins = pkg.coins + pkg.bonus;
    order = {
      kind: 'topup',
      amount: packagePrice(pkg, currency),
      description: `Top up ${coins.toLocaleString('en-US')} coins`,
      meta: { type: 'topup', coins },
    };
  } else if (purpose === 'plan') {
    let { rows: [plan] } = await query('SELECT * FROM plans WHERE code = $1', [String(req.body.planCode)]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const current = await getActiveSubscription(pool, req.userId);
    if (current?.stripe_subscription_id) {
      return res.status(400).json({ error: 'You have an auto-renewing card subscription. Change plans from it, or cancel it first.' });
    }
    if (def.recurring) {
      if (!plan.stripe_price_id || !plan.stripe_price_id_thb) {
        await ensurePlanPrices();
        ({ rows: [plan] } = await query('SELECT * FROM plans WHERE id = $1', [plan.id]));
      }
      return res.json({ url: await createSubscriptionCheckout(req.userId, plan, prefs) });
    }
    order = {
      kind: 'subscription',
      amount: planPrice(plan, currency).amount,
      description: `${plan.name} plan 30-day pass`,
      meta: { type: 'pass', planCode: plan.code },
    };
  } else {
    return res.status(400).json({ error: 'Unknown purchase' });
  }

  const methodId = def.id;
  const payment = await createPendingPayment({
    userId: req.userId, currency, provider: def.provider, method: methodId, ...order,
  });
  const returnUrl = `${APP_URL}/payment/return?pid=${payment.id}`;

  try {
    if (def.provider === 'stripe') {
      const session = await createPaymentCheckout({ userId: req.userId, payment, method: def.id, locale });
      await setProviderRef(payment.id, session.id);
      return res.json({ url: session.url });
    }
    if (def.provider === 'omise') {
      const charge = await createCharge({ method: methodId, amount: order.amount, paymentId: payment.id, returnUri: returnUrl });
      await setProviderRef(payment.id, charge.id);
      if (charge.authorizeUri) return res.json({ url: charge.authorizeUri });
      return res.json({ paymentId: payment.id, qrImage: `/api/billing/payments/${payment.id}/qr`, testUri: charge.testUri });
    }
    const paypalOrder = await createOrder({
      amount: order.amount, currency, paymentId: payment.id, description: order.description, locale,
      returnUrl, cancelUrl: `${returnUrl}&canceled=1`,
    });
    await setProviderRef(payment.id, paypalOrder.id);
    return res.json({ url: paypalOrder.approveUrl });
  } catch (err) {
    await markFailed(payment.id);
    throw err;
  }
});

// Asks the provider whether a pending payment went through, and delivers it if so.
async function settle(payment) {
  if (payment.status !== 'pending' || !payment.provider_ref) return payment.status;
  let status;
  if (payment.provider === 'stripe') status = await checkoutSessionStatus(payment.provider_ref);
  else if (payment.provider === 'omise') status = await chargeStatus(payment.provider_ref);
  else if (payment.provider === 'paypal') {
    status = await captureOrder(payment.provider_ref, { amount: payment.amount_cents, currency: payment.currency });
  } else return payment.status;

  if (status === 'paid') await fulfillPayment(payment.id);
  if (status === 'failed') await markFailed(payment.id);
  return status;
}

async function ownPayment(req) {
  const { rows: [payment] } = await query('SELECT * FROM payments WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.userId]);
  return payment;
}

async function paymentResult(payment, status) {
  const { rows: [user] } = await query('SELECT coins FROM users WHERE id = $1', [payment.user_id]);
  return {
    status,
    kind: payment.kind,
    meta: payment.meta,
    amount: payment.amount_cents,
    currency: payment.currency,
    method: payment.method,
    coins: user.coins,
    subscription: publicSubscription(await getActiveSubscription(pool, payment.user_id)),
  };
}

router.get('/payments/:id/qr', async (req, res) => {
  const payment = await ownPayment(req);
  if (!payment || payment.provider !== 'omise' || !payment.provider_ref) return res.status(404).end();
  const image = await chargeQrImage(payment.provider_ref);
  if (!image) return res.status(404).end();
  res.set('Content-Type', image.type).set('Cache-Control', 'private, max-age=600').send(image.body);
});

router.post('/payments/:id/confirm', async (req, res) => {
  const payment = await ownPayment(req);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(await paymentResult(payment, await settle(payment)));
});

// Customer backed out on the provider's page. Re-check first so a real payment is never dropped.
router.post('/payments/:id/cancel', async (req, res) => {
  const payment = await ownPayment(req);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  let status = await settle(payment);
  if (status === 'pending') {
    await markFailed(payment.id);
    status = 'failed';
  }
  res.json(await paymentResult(payment, status));
});

// Picks up payments finished in a banking/wallet app when the customer never came back to the site.
router.post('/payments/reconcile', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM payments WHERE user_id = $1 AND status = 'pending' AND provider_ref IS NOT NULL
       AND created_at > now() - interval '1 day'`,
    [req.userId],
  );
  let paid = 0;
  for (const payment of rows) {
    if ((await settle(payment).catch(() => 'pending')) === 'paid') paid++;
  }
  res.json({ paid });
});

export { settle };
export default router;
