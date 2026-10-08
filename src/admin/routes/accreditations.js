const express = require('express');
const multer = require('multer');
const AccreditationsController = require('../controllers/accreditationsController');
const { requireAdminSession } = require('../middleware/adminAuth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function createAccreditationsRoutes(pool) {
  const router = express.Router();
  const c = new AccreditationsController(pool);
  router.get('/', requireAdminSession, (req, res) => c.list(req, res));
  router.post('/', requireAdminSession, upload.any(), (req, res) => c.create(req, res));
  router.get('/:id', requireAdminSession, (req, res) => c.getOne(req, res));
  router.put('/:id', requireAdminSession, upload.any(), (req, res) => c.update(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => c.remove(req, res));
  return router;
}

module.exports = createAccreditationsRoutes;
