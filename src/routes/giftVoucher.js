const express = require('express');
const GiftVoucherController = require('../controllers/giftVoucher');
const { authenticateToken } = require('../middleware/auth');

function createGiftVoucherRoutes(pool) {
  const router = express.Router();
  const controller = new GiftVoucherController(pool);

  router.post('/create', (req, res) => controller.createVoucher(req, res));
  router.get('/verify', (req, res) => controller.verifyVoucher(req, res));
  router.get('/template', (req, res) => controller.getVoucherTemplate(req, res));
  router.get('/:id/confirmation/preview', authenticateToken, (req, res) => controller.getVoucherConfirmationPreview(req, res));
  router.post('/:id/confirmation/send', authenticateToken, (req, res) => controller.sendVoucherConfirmationEmail(req, res));
  router.get('/:id', authenticateToken, (req, res) => controller.getVoucherById(req, res));

  return router;
}

module.exports = createGiftVoucherRoutes;
