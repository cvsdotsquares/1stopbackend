// src/routes/priceCalculation.js
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const PriceCalculationController = require('../controllers/priceCalculation');

function createPriceCalculationRoutes(pool) {
  const router = express.Router();
  const priceCalculationController = new PriceCalculationController(pool);

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

  // Validation rules for price calculation
  const priceCalculationValidation = [
    body('course_event_id')
      .isInt({ min: 1 })
      .withMessage('Valid course event ID required'),

    body('attendees')
      .isArray({ min: 1 })
      .withMessage('At least one attendee required'),

    body('attendees.*.vehicle_type')
      .isIn([0, 1, 3])
      .withMessage('Vehicle type must be 0 (Manual), 1 (Automatic), or 3 (Own Vehicle)'),

    body('promo_code_id')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Valid promo code ID required if provided'),

    body('promo_eligible_count')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Eligible attendee count must be a non-negative integer'),

    body('apply_deposit_logic')
      .optional()
      .isBoolean()
      .withMessage('Apply deposit logic must be boolean')
  ];

  // Course event validation
  const courseEventValidation = [
    param('course_event_id')
      .isInt({ min: 1 })
      .withMessage('Valid course event ID required')
  ];

  // Routes

  // Main price calculation endpoint
  router.post('/calculate',
    priceCalculationValidation,
    handleValidationErrors,
    priceCalculationController.calculatePrice.bind(priceCalculationController)
  );

  // Validate course event
  router.get('/validate/:course_event_id',
    courseEventValidation,
    handleValidationErrors,
    priceCalculationController.validateCourseEvent.bind(priceCalculationController)
  );

  // Get pricing options for a course event
  router.get('/options/:course_event_id',
    courseEventValidation,
    handleValidationErrors,
    priceCalculationController.getPricingOptions.bind(priceCalculationController)
  );

  return router;
}

module.exports = createPriceCalculationRoutes;