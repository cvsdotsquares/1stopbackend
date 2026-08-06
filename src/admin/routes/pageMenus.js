const express = require('express');
const PageMenusController = require('../controllers/pageMenusController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createPageMenusRoutes(pool) {
  const router = express.Router();
  const controller = new PageMenusController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/form-options', requireAdminSession, (req, res) =>
    controller.formOptions(req, res)
  );
  router.post('/sort', requireAdminSession, (req, res) =>
    controller.updateSort(req, res)
  );
  router.post('/group-sort', requireAdminSession, (req, res) =>
    controller.updateGroupSort(req, res)
  );

  router.get('/groups', requireAdminSession, (req, res) =>
    controller.listGroups(req, res)
  );
  router.post('/groups', requireAdminSession, (req, res) =>
    controller.createGroup(req, res)
  );
  router.put('/groups/rename', requireAdminSession, (req, res) =>
    controller.renameGroup(req, res)
  );
  router.delete('/groups/:id', requireAdminSession, (req, res) =>
    controller.deleteGroup(req, res)
  );
  router.get('/groups/:groupName/menus', requireAdminSession, (req, res) =>
    controller.listGroupMenus(req, res)
  );

  router.post('/', requireAdminSession, (req, res) =>
    controller.create(req, res)
  );
  router.get('/:id', requireAdminSession, (req, res) =>
    controller.getById(req, res)
  );
  router.put('/:id', requireAdminSession, (req, res) =>
    controller.update(req, res)
  );
  router.patch('/:id', requireAdminSession, (req, res) =>
    controller.update(req, res)
  );
  router.delete('/:id', requireAdminSession, (req, res) =>
    controller.remove(req, res)
  );

  return router;
}

module.exports = createPageMenusRoutes;
