const express = require('express');
const CourseEventsController = require('../controllers/courseEventsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createCourseEventsRoutes(pool) {
  const router = express.Router();
  const controller = new CourseEventsController(pool);

  router.get('/wizard/form-options', requireAdminSession, (req, res) =>
    controller.wizardFormOptions(req, res)
  );
  router.get('/wizard/calendar', requireAdminSession, (req, res) =>
    controller.wizardCalendar(req, res)
  );
  router.get('/wizard', requireAdminSession, (req, res) =>
    controller.getWizard(req, res)
  );
  router.put('/wizard', requireAdminSession, (req, res) =>
    controller.updateWizard(req, res)
  );
  router.post('/wizard/reset', requireAdminSession, (req, res) =>
    controller.resetWizard(req, res)
  );
  router.post('/wizard/prepare-edit', requireAdminSession, (req, res) =>
    controller.prepareEdit(req, res)
  );
  router.post('/wizard/prepare-bulk-edit', requireAdminSession, (req, res) =>
    controller.prepareBulkEdit(req, res)
  );
  router.post('/wizard/save', requireAdminSession, (req, res) =>
    controller.saveWizard(req, res)
  );
  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/locations-by-course', requireAdminSession, (req, res) =>
    controller.locationsByCourse(req, res)
  );
  router.post('/bulk-delete', requireAdminSession, (req, res) =>
    controller.bulkRemove(req, res)
  );
  router.get('/:id/booking-count', requireAdminSession, (req, res) =>
    controller.bookingCount(req, res)
  );
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createCourseEventsRoutes;
