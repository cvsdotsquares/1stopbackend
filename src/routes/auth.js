// src/routes/auth.js
const express = require('express');
const { body } = require('express-validator');
const AuthController = require('../controllers/auth');
const { authenticateToken } = require('../middleware/auth');

function createAuthRoutes(pool) {
  const router = express.Router();
  const authController = new AuthController(pool);

  // Validation rules
  const registerValidation = [
    body('firstName')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('First name must be between 2 and 50 characters'),
    
    body('surname')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Surname must be between 2 and 50 characters'),
    
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    
    body('confirmEmail')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid confirmation email address')
      .custom((value, { req }) => {
        if (value !== req.body.email) {
          throw new Error('Email confirmation does not match email');
        }
        return true;
      }),
    
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
    
    body('verifyPassword')
      .custom((value, { req }) => {
        if (value !== req.body.password) {
          throw new Error('Password confirmation does not match password');
        }
        return true;
      }),
    
    body('contactNumber1')
      .trim()
      .isMobilePhone('en-GB')
      .withMessage('Please provide a valid UK mobile phone number'),
    
    body('addressLine1')
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage('Address line 1 is required and must not exceed 255 characters'),
    
    body('postcode')
      .trim()
      .matches(/^[A-Z]{1,2}[0-9RCHNQ][0-9A-Z]?\s?[0-9][ABD-HJLNP-UW-Z]{2}$/i)
      .withMessage('Please provide a valid UK postcode'),
    
    body('addressLine2')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 255 })
      .withMessage('Address line 2 must not exceed 255 characters'),
    
    body('addressLine3')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 255 })
      .withMessage('Address line 3 must not exceed 255 characters'),
    
    body('contactNumber2')
      .optional({ values: 'falsy' })
      .trim()
      .isMobilePhone('en-GB')
      .withMessage('Contact 2 must be a valid UK phone number'),
    
    body('contactNumber3')
      .optional({ values: 'falsy' })
      .trim()
      .isMobilePhone('en-GB')
      .withMessage('Contact 3 must be a valid UK phone number')
  ];

  const loginValidation = [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Please provide a valid email address'),
    
    body('password')
      .notEmpty()
      .withMessage('Password is required')
  ];

  const updateProfileValidation = [
    body('first_name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('First name must be between 2 and 50 characters'),
    
    body('sur_name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Surname must be between 2 and 50 characters'),
    
    body('contact1')
      .optional()
      .trim()
      .isMobilePhone('en-GB')
      .withMessage('Contact 1 must be a valid UK phone number'),
    
    body('add1')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Address line 1 must not exceed 255 characters'),
    
    body('add2')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Address line 2 must not exceed 255 characters'),
    
    body('add3')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Address line 3 must not exceed 255 characters'),
    
    body('postcode')
      .optional()
      .trim()
      .matches(/^[A-Z]{1,2}[0-9RCHNQ][0-9A-Z]?\s?[0-9][ABD-HJLNP-UW-Z]{2}$/i)
      .withMessage('Please provide a valid UK postcode'),
    
    body('contact2')
      .optional()
      .trim()
      .isMobilePhone('en-GB')
      .withMessage('Contact 2 must be a valid UK phone number'),
    
    body('contact3')
      .optional()
      .trim()
      .isMobilePhone('en-GB')
      .withMessage('Contact 3 must be a valid UK phone number')
  ];

  const changePasswordValidation = [
    body('currentPassword')
      .notEmpty()
      .withMessage('Current password is required'),
    
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('New password must contain at least one lowercase letter, one uppercase letter, and one number')
  ];

  // Public routes
  router.post('/register', registerValidation, authController.register.bind(authController));
  router.post('/login', loginValidation, authController.login.bind(authController));

  // Protected routes (require authentication)
  router.get('/profile', authenticateToken, authController.getProfile.bind(authController));
  router.put('/profile', authenticateToken, updateProfileValidation, authController.updateProfile.bind(authController));
  router.post('/change-password', authenticateToken, changePasswordValidation, authController.changePassword.bind(authController));

  // Test route to verify token
  router.get('/verify', authenticateToken, (req, res) => {
    res.json({
      success: true,
      message: 'Token is valid',
      user: req.user
    });
  });

  return router;
}

module.exports = createAuthRoutes;