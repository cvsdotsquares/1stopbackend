const express = require('express');
const multer = require('multer');
const FranchisesController = require('../controllers/franchisesController');
const { requireAdminSession } = require('../middleware/adminAuth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const franchiseUpload = upload.fields([
  { name: 'email_logo', maxCount: 1 },
  { name: 'email_header', maxCount: 1 },
  { name: 'email_footer', maxCount: 1 },
]);

function createFranchisesRoutes(pool) {
  const router = express.Router();
  const controller = new FranchisesController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.post(
    '/',
    requireAdminSession,
    franchiseUpload,
    (req, res) => controller.create(req, res)
  );
  router.post('/:id/set-primary', requireAdminSession, (req, res) =>
    controller.setPrimary(req, res)
  );
  router.post('/:id/clear-file-field', requireAdminSession, (req, res) =>
    controller.clearFileField(req, res)
  );
  router.patch('/:id/status', requireAdminSession, (req, res) =>
    controller.updateStatus(req, res)
  );
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.patch(
    '/:id',
    requireAdminSession,
    franchiseUpload,
    (req, res) => controller.update(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createFranchisesRoutes;
