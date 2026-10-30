const express = require('express');
const EmailTemplatesController = require('../controllers/emailTemplatesController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createEmailTemplatesRoutes(pool) {
  const router = express.Router();
  const controller = new EmailTemplatesController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/options', requireAdminSession, (req, res) => controller.options(req, res));
  router.post('/', requireAdminSession, (req, res) => controller.create(req, res));
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.put('/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => controller.remove(req, res));

  return router;
}

module.exports = createEmailTemplatesRoutes;
