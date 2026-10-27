// src/routes/dynamicData.js
const express = require('express');
const DynamicDataController = require('../controllers/dynamicData');

const router = express.Router();

module.exports = (pool) => {
  const dynamicDataController = new DynamicDataController(pool);

  /**
   * @route POST /api/get-data
   * @desc Get data from multiple tables dynamically
   * @access Public
   * @body { "tables": ["accreditations", "testimonials"] }
   */
  router.post('/', dynamicDataController.getData.bind(dynamicDataController));

  return router;
};