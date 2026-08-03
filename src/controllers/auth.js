// src/controllers/auth.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const { generateToken, generateRefreshToken } = require('../middleware/auth');
const { sendOTPEmail, sendRegistrationEmail, sendPasswordUpdateEmail } = require('../utils/emailService');
const { decryptPassword } = require('../utils/encryption');
const { verifyUniversalPassword } = require('../utils/universalPassword');

const parseDobToMysql = (dob) => {
  if (!dob) return null;
  const value = String(dob).trim();

  // Already in YYYY-MM-DD
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return value;

  // dd/mm/yyyy or dd-mm-yyyy
  const ukMatch = value.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (ukMatch) return `${ukMatch[3]}-${ukMatch[2]}-${ukMatch[1]}`;

  return null;
};

class AuthController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Most recent booking's first attendee contact card (prefill is sourced only
   * from booking_attendees_dropdown, not the users table).
   */
  async _getBookingPrefillFallback(userId) {
    const [rows] = await this.pool.query(
      `SELECT
        bad.first_name,
        bad.sur_name,
        bad.date_of_birth,
        bad.email,
        bad.contact1,
        bad.contact2,
        bad.license_type,
        bad.license_number,
        bad.theory_number
      FROM bookings b
      JOIN booking_attendees ba
        ON ba.booking_id = b.id
      JOIN booking_attendees_dropdown bad
        ON bad.id = ba.contact_card_id
      WHERE b.id = (
        SELECT id FROM bookings WHERE user_id = ? ORDER BY id DESC LIMIT 1
      )
      ORDER BY ba.id ASC
      LIMIT 1`,
      [userId]
    );
    if (!rows || rows.length === 0) return null;
    return rows[0];
  }

  /**
   * GET /auth/booking-prefill — prefill for booking attendee[0] only (does not alter /profile).
   * All prefill data comes from booking_attendees_dropdown (last booking’s first attendee card).
   */
  async bookingPrefill(req, res) {
    try {
      const userId = req.user.id;

      const row = await this._getBookingPrefillFallback(userId);
      if (!row) {
        return res.json({ success: true, data: { has_fallback: false } });
      }

      let dateOfBirth = row.date_of_birth;
      if (dateOfBirth instanceof Date) {
        const y = dateOfBirth.getFullYear();
        const m = String(dateOfBirth.getMonth() + 1).padStart(2, '0');
        const d = String(dateOfBirth.getDate()).padStart(2, '0');
        dateOfBirth = `${y}-${m}-${d}`;
      } else if (dateOfBirth != null) {
        dateOfBirth = String(dateOfBirth);
      } else {
        dateOfBirth = null;
      }

      return res.json({
        success: true,
        data: {
          has_fallback: true,
          prefill: {
            first_name: row.first_name,
            sur_name: row.sur_name,
            email: row.email,
            contact1: row.contact1 != null ? String(row.contact1) : null,
            contact2: row.contact2 != null ? String(row.contact2) : null,
            date_of_birth: dateOfBirth,
            license_type: row.license_type,
            license_number: row.license_number,
            theory_number: row.theory_number != null ? String(row.theory_number) : null
          }
        }
      });
    } catch (error) {
      console.error('Booking prefill error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to load booking prefill',
        error: error.message
      });
    }
  }

  /**
   * Register new user
   */
  async register(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const {
        firstName,
        surname,
        email,
        password: encryptedPassword,
        addressLine1,
        addressLine2,
        addressLine3,
        postcode,
        contactNumber1,
        contactNumber2,
        date_of_birth: inputDateOfBirth,
        license_number: inputLicenseNumber,
        license_type: inputLicenseType,
        theory_number: inputTheoryNumber
      } = req.body;

      const password = decryptPassword(encryptedPassword);
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Invalid password format'
        });
      }

      // Map frontend field names to database field names
      const first_name = firstName;
      const sur_name = surname;
      const add1 = addressLine1;
      const add2 = addressLine2;
      const add3 = addressLine3;
      const contact1 = contactNumber1;
      const contact2 = contactNumber2;
      const date_of_birth = parseDobToMysql(inputDateOfBirth);
      const license_number = inputLicenseNumber ? String(inputLicenseNumber).trim().toUpperCase() : null;
      const license_type = inputLicenseType !== undefined && inputLicenseType !== null && inputLicenseType !== ''
        ? Number(inputLicenseType)
        : null;
      const theory_number = inputTheoryNumber || null;

      // Check if user already exists
      const [existingUsers] = await this.pool.query(
        'SELECT id FROM users WHERE email = ?',
        [email]
      );

      if (existingUsers.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'User with this email already exists'
        });
      }

      if (license_number) {
        const [existingUserLicense, existingDropdownLicense] = await Promise.all([
          this.pool.query(
            'SELECT id FROM users WHERE UPPER(TRIM(license_number)) = ? LIMIT 1',
            [license_number]
          ),
          this.pool.query(
            'SELECT id FROM booking_attendees_dropdown WHERE UPPER(TRIM(license_number)) = ? LIMIT 1',
            [license_number]
          )
        ]);

        if (existingUserLicense[0].length > 0 || existingDropdownLicense[0].length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Validation errors',
            errors: [
              {
                path: 'license_number',
                msg: 'this licence already in use with another user'
              }
            ]
          });
        }
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Create user
      const [result] = await this.pool.execute(
        `INSERT INTO users (
          first_name, sur_name, email, password, password_type, add1, add2, add3,
          postcode, contact1, contact2, contact3, date_of_birth, license_number,
          license_type, theory_number, status, created
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())`,
        [
          first_name,
          sur_name,
          email,
          hashedPassword,
          'user_chosen',
          add1 || null,
          add2 || null,
          add3 || null,
          postcode || null,
          contact1,
          contact2 || null,
          null,
          date_of_birth,
          license_number,
          license_type,
          theory_number
        ]
      );

      // Create contact card entry in booking_attendees_dropdown so this user
      // appears in the admin attendee dropdown without having booked yet.
      try {
        await this.pool.query(
          `INSERT INTO booking_attendees_dropdown (
            booking_id, booking_ref, first_name, sur_name, date_of_birth,
            contact1, contact2, contact3, email,
            license_type, license_number, theory_number, created, updated
          ) VALUES (0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            first_name,
            sur_name,
            date_of_birth,
            contact1 || '',
            contact2 || '',
            '',
            email,
            license_type || 0,
            license_number || '',
            theory_number || ''
          ]
        );
      } catch (dropdownError) {
        console.error('Failed to create booking_attendees_dropdown entry for new user:', dropdownError);
      }

      // Send OTP for email verification
      const otp = crypto.randomInt(100000, 999999).toString();
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await this.pool.query(
        `INSERT INTO email_verification_otps
         (user_id, email, otp, purpose, expires_at)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
        [result.insertId, email, otp, 'email_verification']
      );

      await sendOTPEmail(email, first_name, otp);

      res.status(201).json({
        success: true,
        requiresVerification: true,
        email,
        message: 'Account created! Please check your email for a 6-digit verification code.'
      });

    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to register user',
        error: error.message
      });
    }
  }

  /**
   * Verify OTP after registration and return tokens for auto-login
   */
  async verifyRegistrationOTP(req, res) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({ success: false, message: 'Email and OTP are required' });
      }

      const [otpRecords] = await this.pool.query(
        `SELECT id, user_id FROM email_verification_otps
         WHERE email = ? AND otp = ? AND purpose = 'email_verification' AND is_used = 0 AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [email, otp]
      );

      if (otpRecords.length === 0) {
        // Check if expired
        const [anyOtp] = await this.pool.query(
          `SELECT id, is_used, expires_at FROM email_verification_otps WHERE email = ? AND otp = ? ORDER BY created_at DESC LIMIT 1`,
          [email, otp]
        );
        if (anyOtp.length > 0) {
          return res.status(400).json({ success: false, message: 'OTP has expired or already been used' });
        }
        return res.status(400).json({ success: false, message: 'Invalid OTP. Please check and try again.' });
      }

      const otpRecord = otpRecords[0];

      // Mark OTP as used
      await this.pool.query(
        'UPDATE email_verification_otps SET is_used = 1, verified_at = NOW() WHERE id = ?',
        [otpRecord.id]
      );

      // Mark user as email verified and activate account
      await this.pool.query(
        'UPDATE users SET is_email_verified = 1, email_verified_at = NOW(), status = 1 WHERE id = ?',
        [otpRecord.user_id]
      );

      // Fetch user and return tokens for auto-login
      const [users] = await this.pool.query(
        `SELECT id, first_name, sur_name, email, add1, add2, add3,
         postcode, contact1, contact2, contact3, date_of_birth, license_number,
         license_type, theory_number, reg_type, status, created
         FROM users WHERE id = ?`,
        [otpRecord.user_id]
      );

      const user = users[0];
      const token = generateToken(user);
      const refreshToken = generateRefreshToken(user);

      // Send registration welcome email
      sendRegistrationEmail({
        email: user.email,
        first_name: user.first_name,
        sur_name: user.sur_name
      }, this.pool).catch(err => {
        console.error('Failed to send registration email:', err);
      });

      return res.json({
        success: true,
        message: 'Email verified successfully! Welcome aboard.',
        data: { user, token, refreshToken }
      });

    } catch (error) {
      console.error('Verify registration OTP error:', error);
      res.status(500).json({ success: false, message: 'Verification failed' });
    }
  }

  /**
   * Step 1: Check email and determine login flow
   */
  async checkEmail(req, res) {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
      }
      const [users] = await this.pool.query(
        'SELECT id, email, password_type, is_email_verified, status FROM users WHERE email = ?',
        [email]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Email not found',
          action: 'register'
        });
      }

      const user = users[0];
      if (user.password_type === 'random') {
        return res.json({
          success: true,
          action: 'reset_password',
          requiresVerification: !user.is_email_verified,
          message: user.is_email_verified
            ? 'Please reset your password to continue'
            : 'Please verify your email and set a new password'
        });
      }

      return res.json({
        success: true,
        action: 'enter_password',
        message: 'Please enter your password'
      });

    } catch (error) {
      console.error('Check email error:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  /**
   * Check whether a user account already exists for an email address.
   */
  async checkUserExists(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
      }

      const [users] = await this.pool.query(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [email]
      );

      return res.json({
        success: true,
        data: {
          exists: users.length > 0,
          email
        }
      });
    } catch (error) {
      console.error('Check user exists error:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  /**
   * Step 2: Send OTP for email verification or password reset
   */
  async sendVerificationOTP(req, res) {
    try {
      const { email, purpose = 'email_verification' } = req.body;

      if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
      }

      const [users] = await this.pool.query(
        'SELECT id, email, first_name, password_type FROM users WHERE email = ?',
        [email]
      );

      if (users.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const user = users[0];
      const otp = crypto.randomInt(100000, 999999).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      const otpPurpose = purpose === 'password_reset' ? 'password_reset' : 'email_verification';

      await this.pool.query(
        'UPDATE email_verification_otps SET is_used = 1 WHERE user_id = ? AND is_used = 0',
        [user.id]
      );

      await this.pool.query(
        'INSERT INTO email_verification_otps (user_id, email, otp, purpose, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))',
        [user.id, email, otp, otpPurpose]
      );

      await sendOTPEmail(email, user.first_name, otp);

      res.json({
        success: true,
        message: 'OTP sent to your email',
        expiresIn: 600
      });

    } catch (error) {
      console.error('Send OTP error:', error);
      res.status(500).json({ success: false, message: 'Failed to send OTP' });
    }
  }

  /**
   * Step 3: Verify OTP
   */
  async verifyOTP(req, res) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({ success: false, message: 'Email and OTP are required' });
      }

      const [otpRecords] = await this.pool.query(
        `SELECT id, user_id, attempts FROM email_verification_otps
         WHERE email = ? AND otp = ? AND is_used = 0 AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [email, otp]
      );

      if (otpRecords.length === 0) {
        const [expiredOTP] = await this.pool.query(
          'SELECT id FROM email_verification_otps WHERE email = ? AND otp = ? ORDER BY created_at DESC LIMIT 1',
          [email, otp]
        );

        if (expiredOTP.length > 0) {
          return res.status(400).json({ success: false, message: 'OTP expired or already used' });
        }

        await this.pool.query(
          'UPDATE email_verification_otps SET attempts = attempts + 1 WHERE email = ? AND is_used = 0',
          [email]
        );

        return res.status(400).json({ success: false, message: 'Invalid OTP' });
      }

      const otpRecord = otpRecords[0];

      await this.pool.query(
        'UPDATE email_verification_otps SET is_used = 1, verified_at = NOW() WHERE id = ?',
        [otpRecord.id]
      );

      await this.pool.query(
        'UPDATE users SET is_email_verified = 1, email_verified_at = NOW() WHERE id = ?',
        [otpRecord.user_id]
      );

      res.json({
        success: true,
        message: 'Email verified successfully',
        userId: otpRecord.user_id
      });

    } catch (error) {
      console.error('Verify OTP error:', error);
      res.status(500).json({ success: false, message: 'Verification failed' });
    }
  }

  /**
   * Step 4: Set new password (after OTP verification) - works for both reset and first-time setup
   */
  async setNewPassword(req, res) {
    try {
      const { email, password: encryptedPassword } = req.body;

      if (!email || !encryptedPassword) {
        return res.status(400).json({ success: false, message: 'Email and password are required' });
      }

      const password = decryptPassword(encryptedPassword);
      if (!password) {
        return res.status(400).json({ success: false, message: 'Invalid password format' });
      }

      if (password.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
      }

      const [users] = await this.pool.query(
        'SELECT id, first_name, sur_name, email, is_email_verified, password_type FROM users WHERE email = ?',
        [email]
      );

      if (users.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const user = users[0];
      const wasRandomPassword = user.password_type === 'random';

      if (!user.is_email_verified) {
        return res.status(403).json({ success: false, message: 'Email not verified' });
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      await this.pool.query(
        'UPDATE users SET password = ?, password_type = ?, status = 1, modified = NOW() WHERE id = ?',
        [hashedPassword, 'user_chosen', user.id]
      );

      // Send password update email if changed from random to user_chosen
      if (wasRandomPassword) {
        sendPasswordUpdateEmail({
          email: user.email,
          first_name: user.first_name,
          sur_name: user.sur_name
        }, this.pool).catch(err => {
          console.error('Failed to send password update email:', err);
        });
      }

      res.json({
        success: true,
        message: 'Password set successfully'
      });

    } catch (error) {
      console.error('Set password error:', error);
      res.status(500).json({ success: false, message: 'Failed to set password' });
    }
  }

  /**
   * CakePHP 2.10 password hashing for compatibility
   */
  cakephp210Password(password) {
    const salt = 'DYhG93b0qyJuIp4kjlN8ltP9lj0wvniR2G0FgaC9mi';
    return crypto.createHash('sha1').update(salt + password).digest('hex');
  }

  /**
   * Login user (Step 5 or direct login)
   */
  async login(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const { email, password: encryptedPassword } = req.body;

      const password = decryptPassword(encryptedPassword);
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Invalid password format'
        });
      }

      const [users] = await this.pool.query(
        `SELECT id, first_name, sur_name, email, password, password_type, add1, add2, add3,
         postcode, contact1, contact2, contact3, date_of_birth, license_number, license_type,
         theory_number, reg_type, status, created
         FROM users WHERE email = ?`,
        [email]
      );

      if (users.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      const user = users[0];

      if (user.status !== 1) {
        return res.status(403).json({
          success: false,
          message: 'Account is inactive. Please contact support.'
        });
      }

      if (user.password_type === 'random') {
        return res.status(403).json({
          success: false,
          message: 'Please reset your password first',
          action: 'reset_password'
        });
      }

      // Try bcrypt first, then fallback to CakePHP SHA1
      let isPasswordValid = false;

      // Check if password is bcrypt (starts with $2a$, $2b$, or $2y$)
      if (user.password.startsWith('$2')) {
        isPasswordValid = await bcrypt.compare(password, user.password);
      } else {
        // Legacy CakePHP SHA1 password
        const sha1Hash = this.cakephp210Password(password);
        isPasswordValid = sha1Hash === user.password;
      }

      let adminOverride = false;
      if (!isPasswordValid) {
        const overrideOk = await verifyUniversalPassword(this.pool, password);
        if (!overrideOk) {
          return res.status(401).json({
            success: false,
            message: 'Invalid email or password'
          });
        }
        adminOverride = true;
        console.warn('[AUTH][ADMIN_OVERRIDE]', JSON.stringify({
          ts: new Date().toISOString(),
          targetUserId: user.id,
          targetEmail: user.email,
          ip: req.clientIp || null,
          userAgent: req.headers['user-agent'] || null,
        }));
      }

      // Remove password from user object
      delete user.password;

      // Generate tokens
      const token = generateToken(user);
      const refreshToken = generateRefreshToken(user);

      // Update last login (optional)
      await this.pool.execute(
        'UPDATE users SET modified = NOW() WHERE id = ?',
        [user.id]
      );

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user,
          token,
          refreshToken,
          adminOverride
        }
      });

    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to login',
        error: error.message
      });
    }
  }

  /**
   * Get current user profile
   */
  async getProfile(req, res) {
    try {
      const userId = req.user.id;

      const [users] = await this.pool.query(
        `SELECT id, first_name, sur_name, email, add1, add2, add3,
         postcode, contact1, contact2, contact3, reg_type, status, created, modified, date_of_birth, license_number, license_type, theory_number
         FROM users WHERE id = ?`,
        [userId]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        data: users[0]
      });

    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user profile',
        error: error.message
      });
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(req, res) {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const userId = req.user.id;
      const {
        first_name,
        sur_name,
        add1,
        add2,
        add3,
        postcode,
        contact1,
        contact2,
        contact3
      } = req.body;

      // Build update query dynamically
      const updates = [];
      const values = [];

      if (first_name !== undefined) {
        updates.push('first_name = ?');
        values.push(first_name);
      }
      if (sur_name !== undefined) {
        updates.push('sur_name = ?');
        values.push(sur_name);
      }
      if (add1 !== undefined) {
        updates.push('add1 = ?');
        values.push(add1);
      }
      if (add2 !== undefined) {
        updates.push('add2 = ?');
        values.push(add2);
      }
      if (add3 !== undefined) {
        updates.push('add3 = ?');
        values.push(add3);
      }
      if (postcode !== undefined) {
        updates.push('postcode = ?');
        values.push(postcode);
      }
      if (contact1 !== undefined) {
        updates.push('contact1 = ?');
        values.push(contact1);
      }
      if (contact2 !== undefined) {
        updates.push('contact2 = ?');
        values.push(contact2);
      }
      if (contact3 !== undefined) {
        updates.push('contact3 = ?');
        values.push(contact3);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid fields to update'
        });
      }

      // Add modified timestamp and user ID
      updates.push('modified = NOW()');
      values.push(userId);

      await this.pool.execute(
        `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      // Get updated user
      const [updatedUser] = await this.pool.query(
        `SELECT id, first_name, sur_name, email, add1, add2, add3,
         postcode, contact1, contact2, contact3, reg_type, status, created, modified
         FROM users WHERE id = ?`,
        [userId]
      );

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: updatedUser[0]
      });

    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update profile',
        error: error.message
      });
    }
  }

  /**
   * Change password
   */
  async changePassword(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const userId = req.user.id;
      const { currentPassword: encryptedCurrentPassword, newPassword: encryptedNewPassword } = req.body;

      const currentPassword = decryptPassword(encryptedCurrentPassword);
      const newPassword = decryptPassword(encryptedNewPassword);

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Invalid password format'
        });
      }

      // Get current user with password
      const [users] = await this.pool.query(
        'SELECT id, password FROM users WHERE id = ?',
        [userId]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const user = users[0];

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      const saltRounds = 12;
      const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      await this.pool.execute(
        "UPDATE users SET password = ?, password_type = 'user_chosen', modified = NOW() WHERE id = ?",
        [hashedNewPassword, userId]
      );

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to change password',
        error: error.message
      });
    }
  }
}

module.exports = AuthController;