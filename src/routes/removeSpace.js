const express = require('express');
const basicAuth = require('../middleware/basicAuth');
const removeSpace = require('../controllers/removeSpace');

function createRemoveSpaceRoutes(pool) {
  const router = express.Router();

  router.all('/remove_space', basicAuth, removeSpace(pool));

  return router;
}

module.exports = createRemoveSpaceRoutes;
