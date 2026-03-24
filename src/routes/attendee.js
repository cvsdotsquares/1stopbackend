const express = require('express');
const AttendeeController = require('../controllers/attendeeData');

function createAttendeeRoutes(pool) {
  const router = express.Router();
  const attendeeController = new AttendeeController(pool);

  router.post('/', attendeeController.getAttendeeNamesByRefs.bind(attendeeController));

  return router;
}

module.exports = createAttendeeRoutes;