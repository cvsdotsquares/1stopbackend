// src/routes/homepage.js
const express = require('express');
const HomepageController = require('../controllers/homepage');

const router = express.Router();

module.exports = (pool) => {
  const homepageController = new HomepageController(pool);

  /**
   * @route GET /api/homepage
   * @desc Get homepage content from existing database tables
   * @access Public
   */
  router.get('/', homepageController.getHomepageContent.bind(homepageController));

  return router;
};