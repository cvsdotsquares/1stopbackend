const express = require('express');
const TransactionsController = require('../controllers/transactionsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createTransactionsRoutes(pool) {
  const router = express.Router();
  const controller = new TransactionsController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createTransactionsRoutes;
