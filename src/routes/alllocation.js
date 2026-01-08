// src/routes/allLocations.js
const express = require('express');
const AllLocationsController = require('../controllers/allLocations');

const router = express.Router();

module.exports = (pool) => {
  const allLocationsController = new AllLocationsController(pool);

  /**
   * @route GET /api/alllocation
   * @desc Get all location content from existing database tables
   * @access Public
   */
  router.get('/', allLocationsController.getalllocation.bind(allLocationsController));

  return router;
};