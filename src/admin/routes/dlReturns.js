const express = require('express');
const DlReturnsController = require('../controllers/dlReturnsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createDlReturnsRoutes(pool) {
  const router = express.Router();
  const controller = new DlReturnsController(pool);

  router.get('/options', requireAdminSession, (req, res) =>
    controller.options(req, res)
  );
  router.get('/certificates/:id', requireAdminSession, (req, res) =>
    controller.getCertificate(req, res)
  );
  router.patch('/certificates/:id', requireAdminSession, (req, res) =>
    controller.updateCertificate(req, res)
  );

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.post('/', requireAdminSession, (req, res) => controller.create(req, res));
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => controller.remove(req, res));
  router.post('/:id/certificate-status', requireAdminSession, (req, res) =>
    controller.updateCertificateStatus(req, res)
  );

  return router;
}

module.exports = createDlReturnsRoutes;
