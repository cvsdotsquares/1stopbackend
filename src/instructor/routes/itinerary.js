const express = require('express');
const InstructorItineraryController = require('../controllers/itineraryController');
const { requireInstructorSession } = require('../middleware/instructorAuth');

function createInstructorItineraryRoutes(pool) {
  const router = express.Router();
  const controller = new InstructorItineraryController(pool);

  router.get('/today', requireInstructorSession, (req, res) =>
    controller.getToday(req, res)
  );

  router.get('/results', requireInstructorSession, (req, res) =>
    controller.getResults(req, res)
  );

  router.post('/results', requireInstructorSession, (req, res) =>
    controller.saveResults(req, res)
  );

  router.get('/previous-results', requireInstructorSession, (req, res) =>
    controller.getPreviousResults(req, res)
  );

  router.get('/attendees/:bid', requireInstructorSession, (req, res) =>
    controller.getAttendee(req, res)
  );

  router.put('/attendees/:bid', requireInstructorSession, (req, res) =>
    controller.updateAttendee(req, res)
  );

  return router;
}

module.exports = createInstructorItineraryRoutes;
