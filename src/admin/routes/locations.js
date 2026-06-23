const express = require('express');
const multer = require('multer');
const LocationsController = require('../controllers/locationsController');
const { requireAdminSession } = require('../middleware/adminAuth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function createLocationsRoutes(pool) {
  const router = express.Router();
  const controller = new LocationsController(pool);

  router.get('/', requireAdminSession, (req, res) =>
    controller.list(req, res)
  );
  router.get('/:id', requireAdminSession, (req, res) =>
    controller.getOne(req, res)
  );
  router.post(
    '/',
    requireAdminSession,
    upload.single('direction_map'),
    (req, res) => controller.create(req, res)
  );
  router.put(
    '/:id',
    requireAdminSession,
    upload.single('direction_map'),
    (req, res) => controller.update(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createLocationsRoutes;
