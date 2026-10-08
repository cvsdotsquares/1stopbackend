const express = require('express');
const TrainingDataController = require('../controllers/trainingDataController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createTrainingDataRoutes(pool) {
  const router = express.Router();
  const controller = new TrainingDataController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.get(req, res));
  router.put('/', requireAdminSession, (req, res) => controller.update(req, res));

  return router;
}

module.exports = createTrainingDataRoutes;
