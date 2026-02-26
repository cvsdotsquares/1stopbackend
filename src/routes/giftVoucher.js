const express = require('express');
const GiftVoucherController = require('../controllers/giftVoucher');

function createGiftVoucherRoutes(pool) {
  const router = express.Router();
  const controller = new GiftVoucherController(pool);

  router.post('/create', (req, res) => controller.createVoucher(req, res));
  router.get('/verify', (req, res) => controller.verifyVoucher(req, res));
  router.get('/template', (req, res) => controller.getVoucherTemplate(req, res));

  return router;
}

module.exports = createGiftVoucherRoutes;
