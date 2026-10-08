const express = require('express');
const multer = require('multer');
const FeaturedServicesController = require('../controllers/featuredServicesController');
const { requireAdminSession } = require('../middleware/adminAuth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function createFeaturedServicesRoutes(pool) {
  const router = express.Router();
  const controller = new FeaturedServicesController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.post('/', requireAdminSession, upload.any(), (req, res) =>
    controller.create(req, res)
  );
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.put('/:id', requireAdminSession, upload.any(), (req, res) =>
    controller.update(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) => controller.remove(req, res));

  return router;
}

module.exports = createFeaturedServicesRoutes;
