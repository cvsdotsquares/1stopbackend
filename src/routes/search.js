// src/routes/search.js
const express = require('express');
const router = express.Router();

module.exports = (pool) => {
  const SearchController = require('../controllers/search');
  const searchController = new SearchController(pool);

  // Auto-suggest endpoint
  router.get('/suggestions', (req, res) => searchController.getSuggestions(req, res));

  // Full search endpoint
  router.get('/', (req, res) => searchController.search(req, res));

  return router;
};
