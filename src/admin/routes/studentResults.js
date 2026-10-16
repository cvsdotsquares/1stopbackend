const express = require('express');
const StudentResultsController = require('../controllers/studentResultsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createStudentResultsRoutes(pool) {
  const router = express.Router();
  const controller = new StudentResultsController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.post('/reorder', requireAdminSession, (req, res) => controller.reorder(req, res));
  router.post('/', requireAdminSession, (req, res) => controller.create(req, res));
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.patch('/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.put('/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => controller.delete(req, res));

  return router;
}

module.exports = createStudentResultsRoutes;
