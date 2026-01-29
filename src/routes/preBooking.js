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

  const lockSpacesValidation = [
    body('event_id').notEmpty().withMessage('Event ID required'),
    body('space_count').isInt({ min: 1 }).withMessage('Valid space count required'),
    body('ip_address').isIP().withMessage('Valid IP address required')
  ];

  const logActivityValidation = [
    body('ip_address').isIP().withMessage('Valid IP address required'),
    body('lock_session_id').notEmpty().withMessage('Lock session ID required'),
    body('booking_status').optional().isIn(['pending', 'completed', 'failed'])
  ];

  const sessionUpdateValidation = [
    body('session_id').notEmpty().withMessage('Session ID required'),
    body('data').isObject().withMessage('Session data required')
  ];

  const externalHoldValidation = [
    body('event_id').notEmpty().withMessage('Event ID required'),
    body('space_count').isInt({ min: 1 }).withMessage('Valid space count required'),
    body('location_id').isInt().withMessage('Valid location ID required')
  ];

  const preBookingValidation = [
    body('event_id').notEmpty().withMessage('Event ID required'),
    body('attendees').isArray({ min: 1 }).withMessage('At least one attendee required'),
    body('user_id').optional().isInt({ min: 0 }),
    body('ip_address').optional().isIP()
  ];

  const cleanupValidation = [
    body('user_id').optional().isInt({ min: 0 }),
    body('ip_address').optional().isIP()
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
  router.get('/course-availability/:eventId', preBookingController.getCourseAvailability.bind(preBookingController));
  router.post('/lock-spaces', lockSpacesValidation, handleValidationErrors, preBookingController.lockSpaces.bind(preBookingController));
  router.post('/create-prebooking', preBookingValidation, handleValidationErrors, preBookingController.createPreBooking.bind(preBookingController));
  router.post('/log-ip-activity', logActivityValidation, handleValidationErrors, preBookingController.logIpActivity.bind(preBookingController));
  router.post('/session/update', sessionUpdateValidation, handleValidationErrors, optionalAuth, preBookingController.updateSession.bind(preBookingController));
  router.post('/external/hold-space', externalHoldValidation, handleValidationErrors, preBookingController.holdExternalSpace.bind(preBookingController));

  // Admin routes
  router.post('/cleanup-locks', authenticateToken, preBookingController.cleanupExpiredLocks.bind(preBookingController));
  router.post('/cleanup-prebookings', cleanupValidation, handleValidationErrors, preBookingController.cleanupExpiredPreBookings.bind(preBookingController));

  return router;
}

module.exports = createPreBookingRoutes;