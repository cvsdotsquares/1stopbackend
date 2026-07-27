const express = require('express');
const BookingsController = require('../controllers/bookingsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createBookingsRoutes(pool) {
  const router = express.Router();
  const controller = new BookingsController(pool);

  router.get('/events/:evId', requireAdminSession, (req, res) =>
    controller.getEventPage(req, res)
  );
  router.post('/events/:evId/lock', requireAdminSession, (req, res) =>
    controller.lockEvent(req, res)
  );
  router.post('/events/:evId/freeze', requireAdminSession, (req, res) =>
    controller.setFreeze(req, res)
  );
  router.delete('/locks/:lockId', requireAdminSession, (req, res) =>
    controller.deleteProcessLock(req, res)
  );
  router.get('/wizard', requireAdminSession, (req, res) =>
    controller.getWizard(req, res)
  );
  router.get('/wizard/customers/search', requireAdminSession, (req, res) =>
    controller.searchWizardCustomers(req, res)
  );
  router.get('/wizard/customers/:id', requireAdminSession, (req, res) =>
    controller.getWizardCustomer(req, res)
  );
  router.post('/wizard/attendees', requireAdminSession, (req, res) =>
    controller.submitWizardAttendees(req, res)
  );
  router.get('/wizard/worldpay', requireAdminSession, (req, res) =>
    controller.getWizardWorldpay(req, res)
  );
  router.post('/wizard/worldpay/notify', (req, res) =>
    controller.notifyWizardWorldpay(req, res)
  );
  router.get('/wizard/worldpay/notify', (req, res) =>
    controller.notifyWizardWorldpay(req, res)
  );
  router.post('/wizard/worldpay/complete', (req, res) =>
    controller.completeWizardWorldpay(req, res)
  );
  router.get('/wizard/worldpay/complete', (req, res) =>
    controller.completeWizardWorldpay(req, res)
  );
  router.post('/wizard/worldpay/cancel', (req, res) =>
    controller.cancelWizardWorldpay(req, res)
  );
  router.get('/wizard/worldpay/cancel', (req, res) =>
    controller.cancelWizardWorldpay(req, res)
  );
  router.post('/wizard/worldpay/finalize', requireAdminSession, (req, res) =>
    controller.finalizeWizardWorldpay(req, res)
  );
  router.get('/wizard/worldpay/finalize', requireAdminSession, (req, res) =>
    controller.finalizeWizardWorldpay(req, res)
  );
  router.get('/wizard/confirmation', requireAdminSession, (req, res) =>
    controller.getWizardConfirmation(req, res)
  );
  router.post('/wizard/cancel', requireAdminSession, (req, res) =>
    controller.cancelWizard(req, res)
  );

  return router;
}

module.exports = createBookingsRoutes;
