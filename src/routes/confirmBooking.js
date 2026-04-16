const express = require('express');
const basicAuth = require('../middleware/basicAuth');
const confirmBooking = require('../controllers/confirmBooking');

const createConfirmBookingRoutes = (pool) => {
  const router = express.Router();
  router.post(['/confirm-booking', '/confirm'], basicAuth, confirmBooking(pool));
  return router;
};

module.exports = createConfirmBookingRoutes;
