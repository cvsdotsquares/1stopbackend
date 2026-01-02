// src/routes/contactus.js
const express = require('express');
const ContactUsController = require('../controllers/contactus');

const router = express.Router();

module.exports = (pool) => {
  const contactUsController = new ContactUsController(pool);

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
  router.post('/', contactUsController.createContactUsEntry.bind(contactUsController));
  return router;
};