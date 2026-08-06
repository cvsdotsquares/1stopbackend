const express = require('express');
const multer = require('multer');
const LocationCoursePagesController = require('../controllers/locationCoursePagesController');
const { requireAdminSession } = require('../middleware/adminAuth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function createLocationCoursePagesRoutes(pool) {
  const router = express.Router();
  const controller = new LocationCoursePagesController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/form-options', requireAdminSession, (req, res) =>
    controller.formOptions(req, res)
  );
  router.get('/section-types', requireAdminSession, (req, res) =>
    controller.sectionTypes(req, res)
  );
  router.post(
    '/with-sections',
    requireAdminSession,
    upload.single('locationPicture'),
    (req, res) => controller.createWithSections(req, res)
  );
  router.post(
    '/sections/upload-image',
    requireAdminSession,
    upload.single('file'),
    (req, res) => controller.uploadImage(req, res)
  );
  router.post('/sections/remove-image', requireAdminSession, (req, res) =>
    controller.removeImage(req, res)
  );

  router.post(
    '/',
    requireAdminSession,
    upload.single('locationPicture'),
    (req, res) => controller.create(req, res)
  );

  router.get('/:id/editor', requireAdminSession, (req, res) =>
    controller.getEditor(req, res)
  );
  router.put('/:id/editor', requireAdminSession, (req, res) =>
    controller.saveEditor(req, res)
  );
  router.post('/:id/sections', requireAdminSession, (req, res) =>
    controller.addSection(req, res)
  );
  router.put('/:id/sections/order', requireAdminSession, (req, res) =>
    controller.reorder(req, res)
  );
  router.patch('/:id/sections/:instanceId', requireAdminSession, (req, res) =>
    controller.patchSection(req, res)
  );
  router.delete('/:id/sections/:instanceId', requireAdminSession, (req, res) =>
    controller.deleteSection(req, res)
  );
  router.post(
    '/:id/sections/:instanceId/restore',
    requireAdminSession,
    (req, res) => controller.restoreSection(req, res)
  );
  router.delete(
    '/:id/sections/:instanceId/items/:itemId',
    requireAdminSession,
    (req, res) => controller.deleteItem(req, res)
  );

  router.get('/:id', requireAdminSession, (req, res) =>
    controller.getById(req, res)
  );
  router.patch('/:id/active', requireAdminSession, (req, res) =>
    controller.toggleActive(req, res)
  );
  router.put(
    '/:id',
    requireAdminSession,
    upload.single('locationPicture'),
    (req, res) => controller.update(req, res)
  );
  router.patch(
    '/:id',
    requireAdminSession,
    upload.single('locationPicture'),
    (req, res) => controller.update(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createLocationCoursePagesRoutes;
