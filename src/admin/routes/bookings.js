const express = require('express');
const BookingsController = require('../controllers/bookingsController');
const BookingDetailsController = require('../controllers/bookingDetailsController');
const BookingWizardController = require('../controllers/bookingWizardController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createBookingsRoutes(pool) {
  const router = express.Router();
  const controller = new BookingsController(pool);
  const detailsController = new BookingDetailsController(pool);
  const wizardController = new BookingWizardController(pool);

  router.post('/:id/refund', requireAdminSession, (req, res) =>
    controller.refund(req, res)
  );
  router.post('/:id/delete', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );
  router.post('/:id/delete-mail-template', requireAdminSession, (req, res) =>
    controller.deleteMailTemplate(req, res)
  );

  router.get('/events/:evId', requireAdminSession, (req, res) =>
    detailsController.getDetails(req, res)
  );
  router.post('/events/:evId/lock', requireAdminSession, (req, res) =>
    detailsController.postLock(req, res)
  );
  router.post('/events/:evId/lock/end', requireAdminSession, (req, res) =>
    detailsController.postLockEnd(req, res)
  );
  router.post('/session/abandon', requireAdminSession, (req, res) =>
    detailsController.postAbandonSession(req, res)
  );
  router.delete('/events/:evId/process-booking', requireAdminSession, (req, res) =>
    detailsController.deleteProcessBooking(req, res)
  );
  router.post('/events/:evId/freeze', requireAdminSession, (req, res) =>
    detailsController.postFreeze(req, res)
  );

  router.get('/wizard', requireAdminSession, (req, res) =>
    wizardController.getWizard(req, res)
  );
  router.post('/wizard/switch-event', requireAdminSession, (req, res) =>
    wizardController.postSwitchEvent(req, res)
  );
  router.post('/wizard/attendees', requireAdminSession, (req, res) =>
    wizardController.postAttendees(req, res)
  );
  router.post('/wizard/promo/check', requireAdminSession, (req, res) =>
    wizardController.postPromoCheck(req, res)
  );
  router.post('/wizard/promo/cancel', requireAdminSession, (req, res) =>
    wizardController.postPromoCancel(req, res)
  );
  router.get('/wizard/customers', requireAdminSession, (req, res) =>
    wizardController.searchCustomers(req, res)
  );
  router.get('/wizard/customers/:userId', requireAdminSession, (req, res) =>
    wizardController.getCustomer(req, res)
  );
  router.post('/payment/stripe/create-intent', requireAdminSession, (req, res) =>
    wizardController.postStripeCreateIntent(req, res)
  );
  router.post('/payment/stripe/confirm', requireAdminSession, (req, res) =>
    wizardController.postStripeConfirm(req, res)
  );
  router.get('/confirmation/cash', requireAdminSession, (req, res) =>
    wizardController.getCashConfirmation(req, res)
  );

  router.get('/:id/view', requireAdminSession, (req, res) => controller.view(req, res));
  router.get('/:id/edit/preview-event', requireAdminSession, (req, res) =>
    controller.previewEvent(req, res)
  );
  router.get('/:id/edit', requireAdminSession, (req, res) => controller.edit(req, res));
  router.patch('/:id', requireAdminSession, (req, res) => controller.patch(req, res));

  router.post('/:id/invoice/email', requireAdminSession, (req, res) =>
    controller.emailInvoice(req, res)
  );
  router.post('/:id/invoice', requireAdminSession, (req, res) =>
    controller.saveInvoice(req, res)
  );
  router.get('/:id/invoice', requireAdminSession, (req, res) =>
    controller.getInvoice(req, res)
  );

  return router;
}

module.exports = createBookingsRoutes;
