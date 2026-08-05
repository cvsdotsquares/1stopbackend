const express = require('express');
const multer = require('multer');
const PagesController = require('../controllers/pagesController');
const PagesEditorController = require('../controllers/pagesEditorController');
const { requireAdminSession } = require('../middleware/adminAuth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function createPagesRoutes(pool) {
  const router = express.Router();
  const controller = new PagesController(pool);
  const editor = new PagesEditorController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/parent-options', requireAdminSession, (req, res) =>
    controller.parentOptions(req, res)
  );
  router.get('/section-types', requireAdminSession, (req, res) =>
    editor.sectionTypes(req, res)
  );
  router.post('/with-sections', requireAdminSession, (req, res) =>
    editor.createWithSections(req, res)
  );
  router.post(
    '/sections/upload-image',
    requireAdminSession,
    upload.single('file'),
    (req, res) => editor.uploadImage(req, res)
  );
  router.post(
    '/sections/remove-image',
    requireAdminSession,
    (req, res) => editor.removeImage(req, res)
  );

  router.post(
    '/',
    requireAdminSession,
    upload.single('carousel_static_image'),
    (req, res) => controller.create(req, res)
  );

  router.get('/:id/editor', requireAdminSession, (req, res) =>
    editor.getEditor(req, res)
  );
  router.put('/:id/editor', requireAdminSession, (req, res) =>
    editor.saveEditor(req, res)
  );
  router.post('/:id/preview-token', requireAdminSession, (req, res) =>
    controller.previewToken(req, res)
  );
  router.post('/:id/sections', requireAdminSession, (req, res) =>
    editor.addSection(req, res)
  );
  router.put('/:id/sections/order', requireAdminSession, (req, res) =>
    editor.reorder(req, res)
  );
  router.patch('/:id/sections/:instanceId', requireAdminSession, (req, res) =>
    editor.patchSection(req, res)
  );
  router.delete('/:id/sections/:instanceId', requireAdminSession, (req, res) =>
    editor.deleteSection(req, res)
  );
  router.post(
    '/:id/sections/:instanceId/restore',
    requireAdminSession,
    (req, res) => editor.restoreSection(req, res)
  );
  router.delete(
    '/:id/sections/:instanceId/items/:itemId',
    requireAdminSession,
    (req, res) => editor.deleteItem(req, res)
  );

  router.patch('/:id', requireAdminSession, (req, res) =>
    controller.patch(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createPagesRoutes;
