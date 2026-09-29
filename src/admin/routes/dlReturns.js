const express = require('express');
const DlReturnsController = require('../controllers/dlReturnsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createDlReturnsRoutes(pool) {
  const router = express.Router();
  const controller = new DlReturnsController(pool);

  router.get('/options', requireAdminSession, (req, res) =>
    controller.options(req, res)
  );
  router.get('/books-by-location', requireAdminSession, (req, res) =>
    controller.booksByLocation(req, res)
  );
  router.get('/check-book-no', requireAdminSession, (req, res) =>
    controller.checkBookNo(req, res)
  );

  router.get('/certificates/lookup-by-number', requireAdminSession, (req, res) =>
    controller.lookupCertificateByNumber(req, res)
  );
  router.get('/certificates/:id/edit-context', requireAdminSession, (req, res) =>
    controller.getCertificateEditContext(req, res)
  );
  router.get('/certificates/:id/attendees', requireAdminSession, (req, res) =>
    controller.getCertificateAttendees(req, res)
  );
  router.get('/certificates/:id/course-start-time', requireAdminSession, (req, res) =>
    controller.getCourseStartTime(req, res)
  );
  router.get('/certificates/:id', requireAdminSession, (req, res) =>
    controller.getCertificate(req, res)
  );
  router.patch('/certificates/:id', requireAdminSession, (req, res) =>
    controller.updateCertificate(req, res)
  );
  router.post('/certificates/:id/reset', requireAdminSession, (req, res) =>
    controller.resetCertificate(req, res)
  );

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.post('/', requireAdminSession, (req, res) => controller.create(req, res));

  router.post('/:id/certificate-status', requireAdminSession, (req, res) =>
    controller.updateCertificateStatus(req, res)
  );
  router.post('/:id/toggle-lock', requireAdminSession, (req, res) =>
    controller.toggleLock(req, res)
  );
  router.post('/:id/export', requireAdminSession, (req, res) =>
    controller.exportBook(req, res)
  );
  router.patch('/:id/book', requireAdminSession, (req, res) =>
    controller.updateBook(req, res)
  );
  router.post('/:id/multi-edit', requireAdminSession, (req, res) =>
    controller.multiEdit(req, res)
  );
  router.get('/:id/attendees-for-date', requireAdminSession, (req, res) =>
    controller.getBookAttendeesForDate(req, res)
  );
  router.get('/:id/course-start-time', requireAdminSession, (req, res) =>
    controller.getBookCourseStartTime(req, res)
  );

  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => controller.remove(req, res));

  return router;
}

module.exports = createDlReturnsRoutes;
