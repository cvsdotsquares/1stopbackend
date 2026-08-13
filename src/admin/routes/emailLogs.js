const express = require('express');
const EmailLogsController = require('../controllers/emailLogsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createEmailLogsRoutes(pool) {
  const router = express.Router();
  const controller = new EmailLogsController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/:id/content', requireAdminSession, (req, res) =>
    controller.content(req, res)
  );
  // Spec also documents POST with body.emailLogId (legacy ajaxFile get_email_log)
  router.post('/:id/content', requireAdminSession, (req, res) =>
    controller.content(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createEmailLogsRoutes;
