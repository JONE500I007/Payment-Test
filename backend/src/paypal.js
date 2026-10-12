// PayPal Orders v2 — redirect to PayPal, capture when the customer comes back.
// https://developer.paypal.com/docs/api/orders/v2/
export const paypalEnabled = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const API = process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

let cachedToken = null;

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth failed: ${data.error_description ?? res.status}`);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function paypal(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

const toValue = (amount) => (amount / 100).toFixed(2);

export async function createOrder({ amount, currency, paymentId, description, returnUrl, cancelUrl, locale }) {
  const { ok, data } = await paypal('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: String(paymentId),
      custom_id: String(paymentId),
      description,
      amount: { currency_code: currency.toUpperCase(), value: toValue(amount) },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Coinly',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          locale: locale === 'th' ? 'th-TH' : 'en-US',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  });
  if (!ok) {
    const err = new Error(`PayPal: ${data.details?.[0]?.description ?? data.message ?? 'could not create order'}`);
    err.status = 400;
    throw err;
  }
  return { id: data.id, approveUrl: data.links.find((l) => l.rel === 'payer-action')?.href };
}

// Captures an approved order (idempotent on PayPal's side). Returns 'paid' | 'pending' | 'failed'.
// Also checks the captured amount, so a tampered order can't be fulfilled.
export async function captureOrder(orderId, { amount, currency }) {
  let { ok, data } = await paypal('POST', `/v2/checkout/orders/${orderId}/capture`);
  if (!ok && data.details?.[0]?.issue === 'ORDER_ALREADY_CAPTURED') {
    ({ data } = await paypal('GET', `/v2/checkout/orders/${orderId}`));
  } else if (!ok) {
    const issue = data.details?.[0]?.issue;
    // Not approved yet (customer hasn't finished on PayPal) — keep waiting.
    return issue === 'ORDER_NOT_APPROVED' ? 'pending' : 'failed';
  }
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  if (data.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') return 'pending';
  const matches = capture.amount.currency_code === currency.toUpperCase() && capture.amount.value === toValue(amount);
  return matches ? 'paid' : 'failed';
}
