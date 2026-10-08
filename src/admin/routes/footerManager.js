const express = require('express');
const FooterManagerController = require('../controllers/footerManagerController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createFooterManagerRoutes(pool) {
  const router = express.Router();
  const c = new FooterManagerController(pool);
  router.get('/', requireAdminSession, (req, res) => c.getState(req, res));
  router.put('/content', requireAdminSession, (req, res) => c.updateContent(req, res));
  router.post('/menu-sections', requireAdminSession, (req, res) => c.saveMenuSection(req, res));
  router.delete('/menu-sections/:id', requireAdminSession, (req, res) =>
    c.deleteMenuSection(req, res)
  );
  router.post('/links', requireAdminSession, (req, res) => c.saveLink(req, res));
  router.delete('/links/:id', requireAdminSession, (req, res) => c.deleteLink(req, res));
  return router;
}

module.exports = createFooterManagerRoutes;
