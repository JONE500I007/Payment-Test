import express, { Router } from 'express';
import { stripe, handleWebhookEvent } from '../stripe.js';

const router = Router();

// Needs the raw body for signature verification, so this router is mounted before express.json().
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(503).json({ error: 'Stripe webhooks are not configured' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    return res.status(400).json({ error: `Invalid signature: ${err.message}` });
  }

  // Handlers are idempotent; a thrown error returns 500 so Stripe retries the event.
  await handleWebhookEvent(event);
  res.json({ received: true });
});

export default router;
