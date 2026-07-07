const express = require('express');
const DeletedBookingsController = require('../controllers/deletedBookingsController');
const AttendingCustomersController = require('../controllers/attendingCustomersController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createCustomersRoutes(pool) {
  const router = express.Router();
  const deletedController = new DeletedBookingsController(pool);
  const attendingController = new AttendingCustomersController(pool);

  router.get('/attending', requireAdminSession, (req, res) =>
    attendingController.list(req, res)
  );
  router.get('/deleted-bookings', requireAdminSession, (req, res) =>
    deletedController.list(req, res)
  );
  router.delete('/deleted-bookings/:bookingId', requireAdminSession, (req, res) =>
    deletedController.purge(req, res)
  );

  return router;
}

module.exports = createCustomersRoutes;
