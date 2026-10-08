const express = require('express');
const multer = require('multer');
const LocationCoursePagesController = require('../controllers/locationCoursePagesController');
const { requireAdminSession } = require('../middleware/adminAuth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function createLocationCoursePagesRoutes(pool) {
  const router = express.Router();
  const controller = new LocationCoursePagesController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/new/editor', requireAdminSession, (req, res) =>
    controller.getNewEditor(req, res)
  );
  router.post('/', requireAdminSession, upload.any(), (req, res) =>
    controller.create(req, res)
  );
  router.get('/:id/editor', requireAdminSession, (req, res) =>
    controller.getEditor(req, res)
  );
  router.put('/:id/editor', requireAdminSession, upload.any(), (req, res) =>
    controller.saveEditor(req, res)
  );
  router.patch('/:id/toggle-active', requireAdminSession, (req, res) =>
    controller.toggleActive(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) => controller.remove(req, res));
  router.post('/:id/sections/remove', requireAdminSession, (req, res) =>
    controller.removeSection(req, res)
  );
  router.post('/:id/sections/remove-item', requireAdminSession, (req, res) =>
    controller.removeItem(req, res)
  );
  router.post('/:id/sections/sort', requireAdminSession, (req, res) =>
    controller.sortSection(req, res)
  );

  return router;
}

module.exports = createLocationCoursePagesRoutes;
