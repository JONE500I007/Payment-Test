import express, { Router } from 'express';
import { query } from '../db.js';
import { omiseEnabled, chargeStatus } from '../omise.js';
import { fulfillPayment, markFailed } from '../fulfillment.js';

const router = Router();

// Opn Payments `charge.complete` events. The payload isn't trusted: we only take the charge id
// and ask the Opn API for its real status.
router.post('/', express.json(), async (req, res) => {
  if (!omiseEnabled) return res.status(503).end();
  const chargeId = req.body?.data?.id;
  if (req.body?.key !== 'charge.complete' || typeof chargeId !== 'string') return res.json({ ignored: true });

  const { rows: [payment] } = await query(
    `SELECT id FROM payments WHERE provider = 'omise' AND provider_ref = $1 AND status = 'pending'`, [chargeId]);
  if (payment) {
    const status = await chargeStatus(chargeId);
    if (status === 'paid') await fulfillPayment(payment.id);
    if (status === 'failed') await markFailed(payment.id);
  }
  res.json({ received: true });
});

export default router;
