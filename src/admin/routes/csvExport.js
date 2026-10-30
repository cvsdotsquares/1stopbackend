const express = require('express');
const CsvExportController = require('../controllers/csvExportController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createCsvExportRoutes(pool) {
  const router = express.Router();
  const controller = new CsvExportController(pool);

  router.get('/payment-links', requireAdminSession, (req, res) => controller.paymentLinks(req, res));
  router.post('/share', requireAdminSession, (req, res) => controller.share(req, res));

  return router;
}

module.exports = createCsvExportRoutes;
