const express = require('express');
const VehiclesController = require('../controllers/vehiclesController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createVehiclesRoutes(pool) {
  const router = express.Router();
  const c = new VehiclesController(pool);

  router.get('/schedule', requireAdminSession, (req, res) =>
    c.schedule(req, res)
  );
  router.get('/mileages', requireAdminSession, (req, res) =>
    c.mileages(req, res)
  );
  router.patch('/mileages', requireAdminSession, (req, res) =>
    c.updateMileages(req, res)
  );
  router.get('/search', requireAdminSession, (req, res) => c.search(req, res));
  router.get('/options', requireAdminSession, (req, res) =>
    c.options(req, res)
  );
  router.get('/status', requireAdminSession, (req, res) =>
    c.statusList(req, res)
  );
  router.get('/settings/types', requireAdminSession, (req, res) =>
    c.settingTypes(req, res)
  );
  router.get('/settings', requireAdminSession, (req, res) =>
    c.settings(req, res)
  );
  router.post('/settings', requireAdminSession, (req, res) =>
    c.createSetting(req, res)
  );
  router.patch('/settings/:id/reorder', requireAdminSession, (req, res) =>
    c.reorderSetting(req, res)
  );
  router.patch('/settings/:id', requireAdminSession, (req, res) =>
    c.updateSetting(req, res)
  );
  router.delete('/settings/:id', requireAdminSession, (req, res) =>
    c.removeSetting(req, res)
  );

  router.get('/', requireAdminSession, (req, res) => c.list(req, res));
  router.post('/', requireAdminSession, (req, res) => c.create(req, res));
  router.get('/:id', requireAdminSession, (req, res) => c.getOne(req, res));
  router.patch('/:id', requireAdminSession, (req, res) => c.update(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => c.remove(req, res));

  router.get('/:id/logs', requireAdminSession, (req, res) => c.logs(req, res));
  router.post('/:id/logs', requireAdminSession, (req, res) =>
    c.addLog(req, res)
  );
  router.patch('/:id/logs/mileage', requireAdminSession, (req, res) =>
    c.patchLogMileage(req, res)
  );
  router.delete('/:id/logs/:logId', requireAdminSession, (req, res) =>
    c.removeLog(req, res)
  );
  router.patch('/logs/:logId', requireAdminSession, (req, res) =>
    c.patchLog(req, res)
  );

  return router;
}

module.exports = createVehiclesRoutes;
