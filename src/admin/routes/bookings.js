const express = require('express');
const BookingsController = require('../controllers/bookingsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createBookingsRoutes(pool) {
  const router = express.Router();
  const controller = new BookingsController(pool);

  router.post('/:id/refund', requireAdminSession, (req, res) =>
    controller.refund(req, res)
  );
  router.post('/:id/delete', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );
  router.post('/:id/delete-mail-template', requireAdminSession, (req, res) =>
    controller.deleteMailTemplate(req, res)
  );

  return router;
}

module.exports = createBookingsRoutes;
