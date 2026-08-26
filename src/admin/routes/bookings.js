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
  router.get('/in-progress', requireAdminSession, (req, res) =>
    controller.getInProgressBookings(req, res)
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
  router.get('/wizard/stripe-link', requireAdminSession, (req, res) =>
    controller.getWizardStripeLink(req, res)
  );
  router.post('/wizard/stripe-link/cancel', requireAdminSession, (req, res) =>
    controller.cancelWizardStripeLink(req, res)
  );
  router.get('/wizard/confirmation', requireAdminSession, (req, res) =>
    controller.getWizardConfirmation(req, res)
  );
  router.post('/wizard/cancel', requireAdminSession, (req, res) =>
    controller.cancelWizard(req, res)
  );
  router.post('/wizard/promo/validate', requireAdminSession, (req, res) =>
    controller.checkWizardPromo(req, res)
  );
  router.post('/wizard/promo/cancel', requireAdminSession, (req, res) =>
    controller.cancelWizardPromo(req, res)
  );

  router.get('/:id/invoice', requireAdminSession, (req, res) =>
    controller.getInvoice(req, res)
  );
  router.post('/:id/invoice', requireAdminSession, (req, res) =>
    controller.saveInvoice(req, res)
  );
  router.post('/:id/invoice/email', requireAdminSession, (req, res) =>
    controller.emailInvoice(req, res)
  );
  router.get('/:id/edit', requireAdminSession, (req, res) =>
    controller.getBookingEditForm(req, res)
  );
  router.get('/:id/delete/mail-template', requireAdminSession, (req, res) =>
    controller.getDeleteMailTemplate(req, res)
  );
  router.post('/:id/refund', requireAdminSession, (req, res) =>
    controller.refundBooking(req, res)
  );
  router.post('/:id/delete', requireAdminSession, (req, res) =>
    controller.deleteBooking(req, res)
  );
  router.get('/:id', requireAdminSession, (req, res) =>
    controller.getBooking(req, res)
  );
  router.patch('/:id', requireAdminSession, (req, res) =>
    controller.patchBooking(req, res)
  );

  return router;
}

module.exports = createBookingsRoutes;
