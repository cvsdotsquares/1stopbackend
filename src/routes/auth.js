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
      .normalizeEmail({ gmail_remove_dots: false })
      .withMessage('Please provide a valid email address'),

    body('confirmEmail')
      .trim()
      .isEmail()
      .normalizeEmail({ gmail_remove_dots: false })
      .withMessage('Please provide a valid confirmation email address')
      .custom((value, { req }) => {
        if (value !== req.body.email) {
          throw new Error('Email confirmation does not match email');
        }
        return true;
      }),

    body('password')
      .notEmpty()
      .withMessage('Password is required'),

    body('contactNumber1')
      .trim()
      .matches(/^\+?[0-9\s()-]+$/)
      .withMessage('Please provide a valid phone number'),

    body('addressLine1')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 255 })
      .withMessage('Address line 1 must not exceed 255 characters'),

    body('postcode')
      .optional({ values: 'falsy' })
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
      .matches(/^\+?[0-9\s()-]+$/)
      .withMessage('Contact 2 must be a valid phone number'),

    body('date_of_birth')
      .optional({ values: 'falsy' })
      .trim()
      .custom((value) => {
        if (!value) return true;
        const str = String(value).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return true; // ISO format
        if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(str)) return true; // booking-form style
        throw new Error('Date of birth must be in dd/mm/yyyy or yyyy-mm-dd format');
      }),

    body('license_number')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ min: 2, max: 32 })
      .withMessage('License number must be between 2 and 32 characters'),

    body('license_type')
      .optional({ values: 'falsy' })
      .isInt({ min: 1 })
      .withMessage('License type must be a valid licence type id'),

    body('theory_number')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 64 })
      .withMessage('Theory number must not exceed 64 characters')
  ];

  const loginValidation = [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail({ gmail_remove_dots: false })
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

  const emailValidation = [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail({ gmail_remove_dots: false })
      .withMessage('Please provide a valid email address')
  ];

  const sendOTPValidation = [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail({ gmail_remove_dots: false })
      .withMessage('Please provide a valid email address'),
    body('purpose')
      .optional()
      .isIn(['email_verification', 'password_reset'])
      .withMessage('Purpose must be either email_verification or password_reset')
  ];

  const otpValidation = [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail({ gmail_remove_dots: false })
      .withMessage('Please provide a valid email address'),
    body('otp')
      .isLength({ min: 6, max: 6 })
      .isNumeric()
      .withMessage('OTP must be a 6-digit number')
  ];

  const setPasswordValidation = [
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail({ gmail_remove_dots: false })
      .withMessage('Please provide a valid email address'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number')
  ];

  // Registration OTP verification
  router.post('/verify-registration-otp', otpValidation, authController.verifyRegistrationOTP.bind(authController));
  router.post('/resend-registration-otp', emailValidation, authController.sendVerificationOTP.bind(authController));

  // New login flow routes
  router.post('/check-email', emailValidation, authController.checkEmail.bind(authController));
  router.post('/check-user-exists', emailValidation, authController.checkUserExists.bind(authController));
  router.post('/send-otp', sendOTPValidation, authController.sendVerificationOTP.bind(authController));
  router.post('/verify-otp', otpValidation, authController.verifyOTP.bind(authController));
  router.post('/set-password', setPasswordValidation, authController.setNewPassword.bind(authController));

  // Forgot password (uses same flow as reset password)
  router.post('/forgot-password', emailValidation, authController.sendVerificationOTP.bind(authController));

  // Public routes
  router.post('/register', registerValidation, authController.register.bind(authController));
  router.post('/login', loginValidation, authController.login.bind(authController));

  // Protected routes (require authentication)
  router.get('/profile', authenticateToken, authController.getProfile.bind(authController));
  router.get('/booking-prefill', authenticateToken, authController.bookingPrefill.bind(authController));
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

  // Debug route to check user status
  router.post('/check-status', async (req, res) => {
    try {
      const { email } = req.body;
      const [users] = await pool.query(
        'SELECT id, email, status, password_type, is_email_verified FROM users WHERE email = ?',
        [email]
      );

      if (users.length === 0) {
        return res.json({ success: false, message: 'User not found' });
      }

      res.json({ success: true, data: users[0] });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = createAuthRoutes;