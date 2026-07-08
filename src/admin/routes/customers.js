const express = require('express');
const DeletedBookingsController = require('../controllers/deletedBookingsController');
const AttendingCustomersController = require('../controllers/attendingCustomersController');
const BlacklistedClientsController = require('../controllers/blacklistedClientsController');
const ContactCardsController = require('../controllers/contactCardsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createCustomersRoutes(pool) {
  const router = express.Router();
  const deletedController = new DeletedBookingsController(pool);
  const attendingController = new AttendingCustomersController(pool);
  const blacklistedController = new BlacklistedClientsController(pool);
  const contactCardsController = new ContactCardsController(pool);

  router.get('/attending', requireAdminSession, (req, res) =>
    attendingController.list(req, res)
  );
  router.get('/blacklisted', requireAdminSession, (req, res) =>
    blacklistedController.list(req, res)
  );
  router.post('/blacklisted/licence-lookup', requireAdminSession, (req, res) =>
    blacklistedController.licenceLookup(req, res)
  );
  router.patch('/contact-cards/:id/blacklist', requireAdminSession, (req, res) =>
    blacklistedController.updateBlacklist(req, res)
  router.get('/contact-cards', requireAdminSession, (req, res) =>
    contactCardsController.list(req, res)
  );
  router.post('/contact-cards', requireAdminSession, (req, res) =>
    contactCardsController.create(req, res)
  );
  router.get('/contact-cards/:id', requireAdminSession, (req, res) =>
    contactCardsController.getOne(req, res)
  );
  router.patch('/contact-cards/:id', requireAdminSession, (req, res) =>
    contactCardsController.update(req, res)
  );
  router.delete('/contact-cards/:id', requireAdminSession, (req, res) =>
    contactCardsController.remove(req, res)
  );
  router.get('/deleted-bookings', requireAdminSession, (req, res) =>
    deletedController.list(req, res)
  );
  router.delete('/deleted-bookings/:bookingId', requireAdminSession, (req, res) =>
    deletedController.purge(req, res)
  );

  return router;
}

module.exports = createCustomersRoutes;
