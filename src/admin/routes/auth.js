const express = require('express');
const AdminAuthController = require('../controllers/authController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createAdminAuthRoutes(pool) {
  const router = express.Router();
  const controller = new AdminAuthController(pool);

  router.get('/branding', (req, res) => controller.branding(req, res));
  router.post('/login', (req, res) => controller.login(req, res));
  router.post('/forgot-password', (req, res) => controller.forgotPassword(req, res));
  router.get('/me', requireAdminSession, (req, res) => controller.me(req, res));
  router.post('/logout', requireAdminSession, (req, res) => controller.logout(req, res));

  return router;
}

module.exports = createAdminAuthRoutes;
