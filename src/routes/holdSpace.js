const express = require('express');
const basicAuth = require('../middleware/basicAuth');
const holdSpace = require('../controllers/holdSpace');

function createHoldSpaceRoutes(pool) {
  const router = express.Router();

  router.all('/hold_space', basicAuth, holdSpace(pool));

  return router;
}

module.exports = createHoldSpaceRoutes;
