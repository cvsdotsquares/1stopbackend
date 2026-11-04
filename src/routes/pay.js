const express = require('express');
const {
  getPublicStripePaymentLinkResult,
} = require('../admin/services/bookingStripeLinkService');

function createPayRoutes(pool) {
  const router = express.Router();

  router.get('/stripe-link-status', async (req, res) => {
    try {
      const data = await getPublicStripePaymentLinkResult(
        pool,
        req.query.session_id
      );
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('[PAY][STRIPE_LINK_STATUS]', err.message);
      }
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load payment status',
      });
    }
  });

  return router;
}

module.exports = createPayRoutes;
