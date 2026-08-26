// src/routes/faq.js
const express = require('express');
const router = express.Router();

module.exports = (pool) => {
  const FAQController = require('../controllers/faq');
  const faqController = new FAQController(pool);

  // GET /api/faq
  router.get('/', (req, res) => faqController.getFAQPageContent(req, res));

  return router;
};
