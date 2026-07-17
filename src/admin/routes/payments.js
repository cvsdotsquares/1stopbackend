const express = require('express');
const MotoPaymentController = require('../controllers/motoPaymentController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createPaymentsRoutes(pool) {
  const router = express.Router();
  const controller = new MotoPaymentController(pool);

  // WorldPay server-to-server Payment Response (no admin session)
  router.post('/moto/notify', (req, res) => controller.notify(req, res));
  router.get('/moto/notify', (req, res) => controller.notify(req, res));

  // Optional browser return URLs from WorldPay
  router.post('/moto/complete', (req, res) => controller.browserResult(req, res));
  router.get('/moto/complete', (req, res) => controller.browserResult(req, res));
  router.post('/moto/cancel', (req, res) => {
    req.query = { ...req.query, status: 'cancel' };
    return controller.browserResult(req, res);
  });
  router.get('/moto/cancel', (req, res) => {
    req.query = { ...req.query, status: 'cancel' };
    return controller.browserResult(req, res);
  });

  router.get('/moto/options', requireAdminSession, (req, res) =>
    controller.options(req, res)
  );
  router.post('/moto', requireAdminSession, (req, res) =>
    controller.initiate(req, res)
  );
  router.get('/moto/status/:ref', requireAdminSession, (req, res) =>
    controller.status(req, res)
  );
  router.post('/moto/mock-complete', requireAdminSession, (req, res) =>
    controller.mockComplete(req, res)
  );

  return router;
}

module.exports = createPaymentsRoutes;
