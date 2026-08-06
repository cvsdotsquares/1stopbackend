const express = require('express');
const FaqsController = require('../controllers/faqsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createFaqsRoutes(pool) {
  const router = express.Router();
  const controller = new FaqsController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/form-options', requireAdminSession, (req, res) =>
    controller.formOptions(req, res)
  );

  router.get('/categories', requireAdminSession, (req, res) =>
    controller.listCategories(req, res)
  );
  router.post('/categories', requireAdminSession, (req, res) =>
    controller.createCategory(req, res)
  );
  router.get('/categories/:id', requireAdminSession, (req, res) =>
    controller.getCategoryById(req, res)
  );
  router.put('/categories/:id', requireAdminSession, (req, res) =>
    controller.updateCategory(req, res)
  );
  router.patch('/categories/:id', requireAdminSession, (req, res) =>
    controller.updateCategory(req, res)
  );
  router.delete('/categories/:id', requireAdminSession, (req, res) =>
    controller.removeCategory(req, res)
  );

  router.post('/', requireAdminSession, (req, res) =>
    controller.create(req, res)
  );
  router.get('/:id', requireAdminSession, (req, res) =>
    controller.getById(req, res)
  );
  router.put('/:id', requireAdminSession, (req, res) =>
    controller.update(req, res)
  );
  router.patch('/:id', requireAdminSession, (req, res) =>
    controller.update(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createFaqsRoutes;
