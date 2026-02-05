// src/routes/webhook.js
const express = require('express');
const WorldPayWebhookController = require('../controllers/worldpayWebhook');

function createWebhookRoutes(pool) {
  const router = express.Router();
  const webhookController = new WorldPayWebhookController(pool);

  // WorldPay payment callback
  router.post('/worldpay', webhookController.handlePaymentCallback.bind(webhookController));

  return router;
}

module.exports = createWebhookRoutes;