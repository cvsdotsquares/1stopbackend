const express = require('express');
const CourseEventsController = require('../controllers/courseEventsController');
const CourseEventWizardController = require('../controllers/courseEventWizardController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createCourseEventsRoutes(pool) {
  const router = express.Router();
  const controller = new CourseEventsController(pool);
  const wizard = new CourseEventWizardController(pool);

  router.get('/filters/courses', requireAdminSession, (req, res) =>
    controller.courseFilters(req, res)
  );
  router.get('/filters/locations', requireAdminSession, (req, res) =>
    controller.locationFilters(req, res)
  );

  router.post('/wizard/start', requireAdminSession, (req, res) =>
    wizard.start(req, res)
  );
  router.get('/wizard/step1', requireAdminSession, (req, res) =>
    wizard.step1Get(req, res)
  );
  router.post('/wizard/step1', requireAdminSession, (req, res) =>
    wizard.step1Post(req, res)
  );
  router.post('/wizard/session-patch', requireAdminSession, (req, res) =>
    wizard.sessionPatch(req, res)
  );
  router.get('/wizard/step2', requireAdminSession, (req, res) =>
    wizard.step2Get(req, res)
  );
  router.post('/wizard/step2', requireAdminSession, (req, res) =>
    wizard.step2Post(req, res)
  );
  router.post('/wizard/multi-fragment', requireAdminSession, (req, res) =>
    wizard.multiFragment(req, res)
  );

  router.post('/:id/edit-load', requireAdminSession, (req, res) =>
    wizard.editLoad(req, res)
  );

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.patch('/:id/status', requireAdminSession, (req, res) =>
    controller.updateStatus(req, res)
  );
  router.get('/:id/booking-count', requireAdminSession, (req, res) =>
    controller.bookingCount(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createCourseEventsRoutes;
