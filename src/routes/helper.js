// src/routes/helper.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const HelperController = require('../controllers/helper');

function createHelperRoutes(pool) {
  const router = express.Router();
  const helperController = new HelperController(pool);

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
  const postalCodeSuggestionValidation = [
    body('query')
      .isString()
      .isLength({ min: 2, max: 10 })
      .withMessage('Query must be between 2 and 10 characters')
      .trim()
  ];

  const menuStructureValidation = [
    body('id')
      .isInt({ min: 1 })
      .withMessage('Valid menu group ID is required')
  ];

  const contentProcessingValidation = [
    body('content')
      .isString()
      .notEmpty()
      .withMessage('Content is required')
  ];

  const licenseValidation = [
    body('license_number')
      .isString()
      .notEmpty()
      .withMessage('License number is required')
      .trim()
  ];

  // Routes
  router.post('/check-blacklisted',
    licenseValidation,
    handleValidationErrors,
    helperController.checkBlacklisted.bind(helperController)
  );

  router.post('/suggest-postal-codes', 
    postalCodeSuggestionValidation, 
    handleValidationErrors, 
    helperController.suggestPostalCodes.bind(helperController)
  );

  router.post('/menu-structure',
    menuStructureValidation,
    handleValidationErrors,
    helperController.getMenuStructure.bind(helperController)
  );

  router.post('/process-content',
    contentProcessingValidation,
    handleValidationErrors,
    helperController.processContent.bind(helperController)
  );

  router.get('/footer-data',
    helperController.getFooterData.bind(helperController)
  );

  router.get('/counter-data',
    helperController.getCounterData.bind(helperController)
  );

  router.get('/location/:slug',
    helperController.getLocationDetail.bind(helperController)
  );

  return router;
}

module.exports = createHelperRoutes;
