const express = require('express');
const FaqsController = require('../controllers/faqsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createFaqsRoutes(pool) {
  const router = express.Router();
  const controller = new FaqsController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/categories', requireAdminSession, (req, res) =>
    controller.listCategories(req, res)
  );
  router.post('/categories', requireAdminSession, (req, res) =>
    controller.createCategory(req, res)
  );
  router.get('/categories/:id', requireAdminSession, (req, res) =>
    controller.getCategory(req, res)
  );
  router.put('/categories/:id', requireAdminSession, (req, res) =>
    controller.updateCategory(req, res)
  );
  router.delete('/categories/:id', requireAdminSession, (req, res) =>
    controller.deleteCategory(req, res)
  );

  router.get('/items/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.post('/items', requireAdminSession, (req, res) => controller.create(req, res));
  router.put('/items/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.delete('/items/:id', requireAdminSession, (req, res) => controller.remove(req, res));

  return router;
}

module.exports = createFaqsRoutes;
