const express = require('express');
const CoursesController = require('../controllers/coursesController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createCoursesRoutes(pool) {
  const router = express.Router();
  const controller = new CoursesController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.post('/', requireAdminSession, (req, res) => controller.create(req, res));
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.patch('/:id/status', requireAdminSession, (req, res) =>
    controller.updateStatus(req, res)
  );
  router.patch('/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => controller.remove(req, res));

  return router;
}

module.exports = createCoursesRoutes;
