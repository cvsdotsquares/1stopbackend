const express = require('express');
const InstructorDlReturnsController = require('../controllers/dlReturnsController');
const { requireInstructorSession } = require('../middleware/instructorAuth');

function createInstructorDlReturnsRoutes(pool) {
  const router = express.Router();
  const controller = new InstructorDlReturnsController(pool);

  router.use(requireInstructorSession);

  router.get('/', (req, res) => controller.list(req, res));
  router.get('/options', (req, res) => controller.options(req, res));
  router.get('/:id', (req, res) => controller.getOne(req, res));
  router.get('/certificates/:id', (req, res) => controller.getCertificate(req, res));
  router.get('/certificates/:id/edit-context', (req, res) =>
    controller.getCertificateEditContext(req, res)
  );
  router.get('/certificates/:id/attendees', (req, res) =>
    controller.getAttendees(req, res)
  );
  router.get('/:bookId/course-start-time', (req, res) =>
    controller.getCourseStartTime(req, res)
  );
  router.patch('/certificates/:id', (req, res) =>
    controller.updateCertificate(req, res)
  );
  router.post('/certificates/:id/reset', (req, res) =>
    controller.resetCertificate(req, res)
  );

  return router;
}

module.exports = createInstructorDlReturnsRoutes;
