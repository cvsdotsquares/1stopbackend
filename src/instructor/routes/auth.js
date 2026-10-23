const express = require('express');
const InstructorAuthController = require('../controllers/authController');
const { requireInstructorSession } = require('../middleware/instructorAuth');

function createInstructorAuthRoutes(pool) {
  const router = express.Router();
  const controller = new InstructorAuthController(pool);

  router.get('/branding', (req, res) => controller.branding(req, res));
  router.post('/login', (req, res) => controller.login(req, res));
  router.get('/me', requireInstructorSession, (req, res) => controller.me(req, res));
  router.post('/logout', requireInstructorSession, (req, res) => controller.logout(req, res));

  return router;
}

module.exports = createInstructorAuthRoutes;
