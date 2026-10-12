// Opn Payments (Omise) — Thai wallets and mobile banking. https://docs.omise.co
const API = 'https://api.omise.co';
export const omiseEnabled = !!process.env.OMISE_SECRET_KEY;

// Our method id -> Omise source type.
export const OMISE_SOURCES = {
  truemoney: 'truemoney_jumpapp',
  truemoney_qr: 'truemoney_qr',
  alipay: 'alipay',
  linepay: 'rabbit_linepay',
  shopeepay: 'shopeepay',
  mobile_banking_kbank: 'mobile_banking_kbank',
  mobile_banking_scb: 'mobile_banking_scb',
  mobile_banking_bay: 'mobile_banking_bay',
  mobile_banking_bbl: 'mobile_banking_bbl',
  mobile_banking_ktb: 'mobile_banking_ktb',
};

// Omise takes form-encoded bodies with bracketed keys for nested objects.
function encode(obj, prefix, out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') encode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function omise(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.OMISE_SECRET_KEY}:`).toString('base64')}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? encode(body) : undefined,
  });
  const data = await res.json();
  if (data.object === 'error') {
    const err = new Error(`Opn Payments: ${data.message}`);
    err.status = res.status >= 500 ? 502 : 400;
    throw err;
  }
  return data;
}

// Creates the source and charge in one call. The customer finishes payment at `authorize_uri`
// (redirect / app) or by scanning `qrImage`.
export async function createCharge({ method, amount, paymentId, returnUri }) {
  const charge = await omise('POST', '/charges', {
    amount,
    currency: 'THB',
    return_uri: returnUri,
    source: { type: OMISE_SOURCES[method] },
    metadata: { paymentId },
  });
  // Offline (QR) flows are paid by scanning; in test mode Opn still gives an authorize_uri,
  // which we pass along as a simulator link instead of redirecting.
  const isQr = charge.source?.flow === 'offline' && !!charge.source?.scannable_code;
  return {
    id: charge.id,
    authorizeUri: isQr ? null : charge.authorize_uri,
    qr: isQr,
    testUri: isQr && charge.livemode === false ? charge.authorize_uri : null,
  };
}

// 'paid' | 'pending' | 'failed'
export async function chargeStatus(chargeId) {
  const charge = await omise('GET', `/charges/${chargeId}`);
  if (charge.status === 'successful' && charge.paid) return 'paid';
  if (['failed', 'expired', 'reversed'].includes(charge.status)) return 'failed';
  return 'pending';
}

// The QR image URL of an offline-flow charge needs our secret key, so the API proxies it.
export async function chargeQrImage(chargeId) {
  const charge = await omise('GET', `/charges/${chargeId}`);
  const url = charge.source?.scannable_code?.image?.download_uri;
  if (!url) return null;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.OMISE_SECRET_KEY}:`).toString('base64')}` },
  });
  if (!res.ok) return null;
  return { type: res.headers.get('content-type') ?? 'image/png', body: Buffer.from(await res.arrayBuffer()) };
}
