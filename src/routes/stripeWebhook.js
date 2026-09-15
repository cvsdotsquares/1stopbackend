// src/routes/stripeWebhook.js
const express = require('express');
const router = express.Router();

module.exports = (pool) => {
  const StripeWebhookController = require('../controllers/stripeWebhook');
  const stripeWebhookController = new StripeWebhookController(pool);

  // Stripe webhook endpoint (raw body needed for signature verification)
  // Note: This route must be registered BEFORE express.json() middleware
  router.post('/stripe', 
    express.raw({ type: 'application/json' }), 
    (req, res) => {
      stripeWebhookController.handleWebhook(req, res);
    }
  );

  // Payment verification endpoint (uses JSON middleware)
  router.get('/stripe/verify', (req, res) => {
    stripeWebhookController.verifyPayment(req, res);
  });

  return router;
};