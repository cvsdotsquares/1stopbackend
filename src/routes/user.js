// src/routes/user.js
const express = require('express');
const UserController = require('../controllers/user');
const { authenticateToken } = require('../middleware/auth');

function createUserRoutes(pool) {
  const router = express.Router();
  const userController = new UserController(pool);

  router.get('/profile', authenticateToken, userController.getProfile.bind(userController));
  router.put('/profile', authenticateToken, userController.updateProfile.bind(userController));

  return router;
}

module.exports = createUserRoutes;
