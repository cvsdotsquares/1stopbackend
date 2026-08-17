const express = require('express');
const DashboardController = require('../controllers/dashboardController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createDashboardRoutes(pool) {
  const router = express.Router();
  const controller = new DashboardController(pool);

  router.get('/', requireAdminSession, (req, res) =>
    controller.getDashboard(req, res)
  );
  router.get('/current-lock-count', requireAdminSession, (req, res) =>
    controller.getCurrentLockCount(req, res)
  );
  router.get('/in-progress-bookings', requireAdminSession, (req, res) =>
    controller.getInProgressBookings(req, res)
  );
  router.get('/next-course-dates', requireAdminSession, (req, res) =>
    controller.getNextCourseDates(req, res)
  );

  return router;
}

module.exports = createDashboardRoutes;
