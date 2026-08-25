// src/routes/contactus.js
const express = require('express');
const ContactUsController = require('../controllers/contactus');
const createSecurityGuard = require('../middleware/securityGuard');

const router = express.Router();

module.exports = (pool) => {
  const contactUsController = new ContactUsController(pool);
  const security = createSecurityGuard(pool);

  /**
   * @route GET /api/contactus
   * @desc Get contact us content from existing database tables
   * @access Public
   */
  router.get('/', contactUsController.getContactUsContent.bind(contactUsController));

  /**
   * @route POST /api/contactus
   * @desc Create a new contact us entry in the database
   * @access Public
   */
  router.post(
    '/',
    security.rejectMaliciousBody,
    security.verifyRecaptcha(),
    security.rateLimit('contact_form'),
    contactUsController.createContactUsEntry.bind(contactUsController)
  );
  return router;
};