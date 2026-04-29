// src/routes/preBooking.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const PreBookingController = require('../controllers/preBooking');
const { authenticateToken } = require('../middleware/auth');

function createPreBookingRoutes(pool) {
  const router = express.Router();
  const preBookingController = new PreBookingController(pool);

  // Validation middleware
  const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }
    next();
  };

  // Validation rules
  const ipBlockValidation = [
    body('ip_address').isIP().withMessage('Valid IP address required')
  ];

  const logActivityValidation = [
    body('ip_address').isIP().withMessage('Valid IP address required'),
    body('lock_session_id').notEmpty().withMessage('Lock session ID required'),
    body('booking_status').optional().isIn(['pending', 'completed', 'failed'])
  ];

  // Optional auth middleware
  const optionalAuth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      return authenticateToken(req, res, next);
    }
    next();
  };

  // Public routes
  router.post('/check-ip-block', ipBlockValidation, handleValidationErrors, preBookingController.checkIpBlock.bind(preBookingController));
  router.post('/log-ip-activity', logActivityValidation, handleValidationErrors, preBookingController.logIpActivity.bind(preBookingController));
  return router;
}

module.exports = createPreBookingRoutes;