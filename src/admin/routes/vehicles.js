const express = require('express');
const VehiclesController = require('../controllers/vehiclesController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createVehiclesRoutes(pool) {
  const router = express.Router();
  const controller = new VehiclesController(pool);

  router.get('/schedule', requireAdminSession, (req, res) =>
    controller.schedule(req, res)
  );
  router.get('/options', requireAdminSession, (req, res) =>
    controller.options(req, res)
  );
  router.get('/settings/types', requireAdminSession, (req, res) =>
    controller.settingTypes(req, res)
  );
  router.get('/search', requireAdminSession, (req, res) =>
    controller.search(req, res)
  );
  router.patch('/mileages', requireAdminSession, (req, res) =>
    controller.updateMileages(req, res)
  );
  router.get('/status', requireAdminSession, (req, res) =>
    controller.statusPage(req, res)
  );
  router.post('/ajax/update-location', requireAdminSession, (req, res) =>
    controller.updateLocationAjax(req, res)
  );
  router.post('/ajax/update-issue-status', requireAdminSession, (req, res) =>
    controller.updateIssueStatusAjax(req, res)
  );

  router.get('/settings', requireAdminSession, (req, res) =>
    controller.listSettings(req, res)
  );
  router.post('/settings', requireAdminSession, (req, res) =>
    controller.createSetting(req, res)
  );
  router.patch('/settings/:id', requireAdminSession, (req, res) =>
    controller.updateSetting(req, res)
  );
  router.delete('/settings/:id', requireAdminSession, (req, res) =>
    controller.deleteSetting(req, res)
  );

  router.patch('/logs/:logId', requireAdminSession, (req, res) =>
    controller.updateLog(req, res)
  );
  router.delete('/logs/:logId', requireAdminSession, (req, res) =>
    controller.deleteLog(req, res)
  );

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.post('/', requireAdminSession, (req, res) => controller.create(req, res));

  router.get('/:id/logs', requireAdminSession, (req, res) =>
    controller.listLogs(req, res)
  );
  router.post('/:id/logs', requireAdminSession, (req, res) =>
    controller.createLog(req, res)
  );
  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.patch('/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => controller.remove(req, res));

  return router;
}

module.exports = createVehiclesRoutes;
