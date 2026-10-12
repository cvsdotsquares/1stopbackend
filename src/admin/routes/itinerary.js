const express = require('express');
const ItineraryController = require('../controllers/itineraryController');
const { requireAdminSession } = require('../middleware/adminAuth');

const createStudentResultsRoutes = require('./studentResults');

function createItineraryRoutes(pool) {
  const router = express.Router();
  const controller = new ItineraryController(pool);

  router.get('/day', requireAdminSession, (req, res) =>
    controller.getDayPage(req, res)
  );
  router.post('/day-note', requireAdminSession, (req, res) =>
    controller.saveDayNote(req, res)
  );
  router.post('/student-results', requireAdminSession, (req, res) =>
    controller.saveStudentResults(req, res)
  );
  router.use('/result-options', createStudentResultsRoutes(pool));

  return router;
}

module.exports = createItineraryRoutes;
