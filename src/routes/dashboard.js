// src/routes/dashboard.js
const express = require('express');
const DashboardController = require('../controllers/dashboard');
const { authenticateToken } = require('../middleware/auth');

function createDashboardRoutes(pool) {
  const router = express.Router();
  const dashboardController = new DashboardController(pool);

  router.get('/', authenticateToken, dashboardController.getUserDashboard.bind(dashboardController));

  return router;
}

module.exports = createDashboardRoutes;
