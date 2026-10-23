const express = require('express');
const InstructorVehiclesController = require('../controllers/vehiclesController');
const { requireInstructorSession } = require('../middleware/instructorAuth');

function createInstructorVehiclesRoutes(pool) {
  const router = express.Router();
  const controller = new InstructorVehiclesController(pool);

  router.use(requireInstructorSession);

  router.get('/schedule', (req, res) => controller.schedule(req, res));
  router.get('/options', (req, res) => controller.options(req, res));
  router.patch('/mileages', (req, res) => controller.updateMileages(req, res));
  router.get('/status', (req, res) => controller.statusPage(req, res));
  router.post('/ajax/update-location', (req, res) => controller.updateLocation(req, res));
  router.delete('/logs/:logId', (req, res) => controller.deleteLog(req, res));
  router.get('/:id/logs', (req, res) => controller.getLogs(req, res));
  router.post('/:id/logs', (req, res) => controller.createLog(req, res));
  router.patch('/:id/logs/:logId', (req, res) => controller.updateLog(req, res));
  router.get('/:id', (req, res) => controller.getOne(req, res));
  router.post('/ajax/update-issue-status', (req, res) =>
    controller.updateIssueStatus(req, res)
  );

  return router;
}

module.exports = createInstructorVehiclesRoutes;
