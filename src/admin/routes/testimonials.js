const express = require('express');
const TestimonialsController = require('../controllers/testimonialsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createTestimonialsRoutes(pool) {
  const router = express.Router();
  const controller = new TestimonialsController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
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

module.exports = createTestimonialsRoutes;
