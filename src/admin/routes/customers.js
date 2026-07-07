const express = require('express');
const DeletedBookingsController = require('../controllers/deletedBookingsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createCustomersRoutes(pool) {
  const router = express.Router();
  const controller = new DeletedBookingsController(pool);

  router.get('/deleted-bookings', requireAdminSession, (req, res) =>
    controller.list(req, res)
  );
  router.delete('/deleted-bookings/:bookingId', requireAdminSession, (req, res) =>
    controller.purge(req, res)
  );

  return router;
}

module.exports = createCustomersRoutes;
