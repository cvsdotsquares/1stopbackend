const express = require('express');
const { requireAdminSession } = require('../middleware/adminAuth');
const { quickSearch, globalSearch } = require('../controllers/searchController');

function createSearchRoutes(pool) {
  const router = express.Router();

  router.get('/quick', requireAdminSession, (req, res) => quickSearch(pool, req, res));
  router.get('/global', requireAdminSession, (req, res) => globalSearch(pool, req, res));

  return router;
}

module.exports = createSearchRoutes;
