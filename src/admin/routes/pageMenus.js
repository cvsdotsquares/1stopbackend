const express = require('express');
const PageMenusController = require('../controllers/pageMenusController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createPageMenusRoutes(pool) {
  const router = express.Router();
  const controller = new PageMenusController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/tree', requireAdminSession, (req, res) => controller.tree(req, res));
  router.get('/options', requireAdminSession, (req, res) => controller.options(req, res));
  router.post('/reorder', requireAdminSession, (req, res) => controller.reorderGroup(req, res));
  router.post('/reorder-flat', requireAdminSession, (req, res) =>
    controller.reorderFlat(req, res)
  );
  router.post('/sort', requireAdminSession, (req, res) => controller.reorderFlat(req, res));

  router.get('/groups', requireAdminSession, (req, res) => controller.listGroups(req, res));
  router.post('/groups', requireAdminSession, (req, res) => controller.createGroup(req, res));
  router.delete('/groups/:id', requireAdminSession, (req, res) =>
    controller.deleteGroup(req, res)
  );
  router.patch('/groups/rename', requireAdminSession, (req, res) =>
    controller.renameGroup(req, res)
  );

  router.get('/:id', requireAdminSession, (req, res) => controller.getOne(req, res));
  router.post('/', requireAdminSession, (req, res) => controller.create(req, res));
  router.put('/:id', requireAdminSession, (req, res) => controller.update(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => controller.remove(req, res));

  return router;
}

module.exports = createPageMenusRoutes;
