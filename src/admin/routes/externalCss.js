const express = require('express');
const ExternalCssController = require('../controllers/externalCssController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createExternalCssRoutes() {
  const router = express.Router();
  const controller = new ExternalCssController();

  router.get('/', requireAdminSession, (req, res) => controller.get(req, res));
  router.put('/', requireAdminSession, (req, res) => controller.save(req, res));

  return router;
}

module.exports = createExternalCssRoutes;
