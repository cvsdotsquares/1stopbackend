const express = require('express');
const basicAuth = require('../middleware/basicAuth');
const checkAvailability = require('../controllers/checkAvailability');

const createCheckAvailabilityRoutes = (pool) => {
  const router = express.Router();
  router.post('/check-availability', basicAuth, checkAvailability(pool));
  return router;
};

module.exports = createCheckAvailabilityRoutes;
