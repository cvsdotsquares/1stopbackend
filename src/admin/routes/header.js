const express = require('express');
const HeaderController = require('../controllers/headerController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createHeaderRoutes(pool) {
  const router = express.Router();
  const controller = new HeaderController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.getHeader(req, res));

  return router;
}

module.exports = createHeaderRoutes;
