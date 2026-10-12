const express = require('express');
const multer = require('multer');
const SettingsController = require('../controllers/settingsController');
const { requireAdminSession } = require('../middleware/adminAuth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function createSettingsRoutes(pool) {
  const router = express.Router();
  const controller = new SettingsController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.get(req, res));
  router.put('/', requireAdminSession, upload.any(), (req, res) =>
    controller.update(req, res)
  );

  return router;
}

module.exports = createSettingsRoutes;
