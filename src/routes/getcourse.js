const express = require('express');
const basicAuth = require('../middleware/basicAuth');
const getCourse = require('../controllers/getcourse');

/**
 * Route for GET /restapi/booking/getcourse
 * Uses Basic Authentication
 * Matches PHP behavior of restapi/booking/getcourse.php
 */
function createGetcourseRoutes(pool) {
  const router = express.Router();

  /**
   * @route   GET /restapi/booking/getcourse
   * @desc    Get available courses from booking_status for specific locations
   * @access  Private (Basic Auth required)
   * @auth    Basic <base64(token)>
   * @returns {Object} { course: [] }
   */
  router.get('/getcourse', basicAuth, getCourse(pool));

  return router;
}

module.exports = createGetcourseRoutes;
