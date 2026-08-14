const express = require('express');
const DlReturnsController = require('../controllers/dlReturnsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createDlReturnsRoutes(pool) {
  const router = express.Router();
  const c = new DlReturnsController(pool);

  router.get('/', requireAdminSession, (req, res) => c.list(req, res));
  router.get('/options', requireAdminSession, (req, res) =>
    c.options(req, res)
  );
  router.post('/', requireAdminSession, (req, res) => c.create(req, res));
  router.get('/certificates/:certId', requireAdminSession, (req, res) =>
    c.getCert(req, res)
  );
  router.patch('/certificates/:certId', requireAdminSession, (req, res) =>
    c.patchCert(req, res)
  );
  router.post('/certificates/:certId/reset', requireAdminSession, (req, res) =>
    c.resetCert(req, res)
  );
  router.get('/:id', requireAdminSession, (req, res) => c.getOne(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => c.remove(req, res));
  router.post('/:id/certificate-status', requireAdminSession, (req, res) =>
    c.status(req, res)
  );
  router.post('/:id/export', requireAdminSession, (req, res) =>
    c.exportBook(req, res)
  );

  return router;
}

module.exports = createDlReturnsRoutes;
