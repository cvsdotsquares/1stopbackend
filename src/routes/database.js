// src/routes/database.js
const express = require('express');
const DatabaseController = require('../controllers/database');

function createDatabaseRoutes(pool) {
  const router = express.Router();
  const databaseController = new DatabaseController(pool);

  /**
   * @route GET /api/database/tables
   * @desc Get list of all database tables
   * @access Private (for development/admin use)
   */
  router.get('/tables', databaseController.getTables.bind(databaseController));

  /**
   * @route GET /api/database/table/:tableName
   * @desc Get structure and sample data from a specific table
   * @access Private (for development/admin use)
   */
  router.get('/table/:tableName', databaseController.getTableStructure.bind(databaseController));

  /**
   * @route GET /api/database/cms-search
   * @desc Search for CMS-related tables and content
   * @access Private (for development/admin use)
   */
  router.get('/cms-search', databaseController.searchCMSContent.bind(databaseController));

  return router;
}

module.exports = createDatabaseRoutes;