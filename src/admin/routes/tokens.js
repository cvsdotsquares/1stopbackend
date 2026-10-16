const express = require('express');
const TokensController = require('../controllers/tokensController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createTokensRoutes(pool) {
  const router = express.Router();
  const controller = new TokensController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.post('/', requireAdminSession, (req, res) => controller.create(req, res));
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.put('/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.patch('/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => controller.delete(req, res));

  return router;
}

module.exports = createTokensRoutes;
