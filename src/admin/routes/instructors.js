const express = require('express');
const InstructorsController = require('../controllers/instructorsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createInstructorsRoutes(pool) {
  const router = express.Router();
  const controller = new InstructorsController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.post('/', requireAdminSession, (req, res) => controller.create(req, res));
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.patch('/:id/status', requireAdminSession, (req, res) => controller.toggleStatus(req, res));
  router.patch('/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.put('/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => controller.delete(req, res));

  return router;
}

module.exports = createInstructorsRoutes;
