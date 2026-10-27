const express = require('express');
const router = express.Router();

module.exports = (pool) => {
  const DebugVoucherController = require('../controllers/debugVoucher');
  const controller = new DebugVoucherController(pool);

  router.get('/debug-flow', (req, res) => controller.debugVoucherFlow(req, res));
  router.get('/manual-process', (req, res) => controller.manualProcessVoucher(req, res));
  router.post('/manual-process', (req, res) => controller.manualProcessVoucher(req, res));

  return router;
};
