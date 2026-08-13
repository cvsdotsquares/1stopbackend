const express = require('express');
const CustomersController = require('../controllers/customersController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createCustomersRoutes(pool) {
  const router = express.Router();
  const controller = new CustomersController(pool);

  // Contact cards (F-033)
  router.get('/contact-cards', requireAdminSession, (req, res) =>
    controller.listContactCards(req, res)
  );
  router.post('/contact-cards', requireAdminSession, (req, res) =>
    controller.createContactCard(req, res)
  );
  router.get('/contact-cards/:id', requireAdminSession, (req, res) =>
    controller.getContactCard(req, res)
  );
  router.patch('/contact-cards/:id', requireAdminSession, (req, res) =>
    controller.updateContactCard(req, res)
  );
  router.delete('/contact-cards/:id', requireAdminSession, (req, res) =>
    controller.deleteContactCard(req, res)
  );
  router.patch('/contact-cards/:id/blacklist', requireAdminSession, (req, res) =>
    controller.setBlacklist(req, res)
  );

  // Blacklisted (F-034)
  router.get('/blacklisted', requireAdminSession, (req, res) =>
    controller.listBlacklisted(req, res)
  );
  router.get('/licence-lookup', requireAdminSession, (req, res) =>
    controller.fetchLicenceDetails(req, res)
  );

  // Deleted bookings (F-032)
  router.get('/deleted-bookings', requireAdminSession, (req, res) =>
    controller.listDeletedBookings(req, res)
  );
  router.delete('/deleted-bookings/:id', requireAdminSession, (req, res) =>
    controller.purgeDeletedBooking(req, res)
  );

  // Attending (F-031)
  router.get('/attending', requireAdminSession, (req, res) =>
    controller.listAttending(req, res)
  );

  // Members (F-030)
  router.get('/members', requireAdminSession, (req, res) =>
    controller.listMembers(req, res)
  );
  router.get('/members/:id', requireAdminSession, (req, res) =>
    controller.getMember(req, res)
  );
  router.patch('/members/:id', requireAdminSession, (req, res) =>
    controller.updateMember(req, res)
  );
  router.get('/members/:id/bookings', requireAdminSession, (req, res) =>
    controller.listMemberBookings(req, res)
  );

  return router;
}

module.exports = createCustomersRoutes;
