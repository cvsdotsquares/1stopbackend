// src/controllers/auth.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const { generateToken, generateRefreshToken } = require('../middleware/auth');
const { sendOTPEmail, sendRegistrationEmail, sendPasswordUpdateEmail } = require('../utils/emailService');
const { decryptPassword } = require('../utils/encryption');

class AuthController {
  constructor(pool) {
    this.pool = pool;
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
        contactNumber3,
        reg_type = 'm'
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
      const contact3 = contactNumber3;

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

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Create user
      const [result] = await this.pool.execute(
        `INSERT INTO users (
          first_name, sur_name, email, password, password_type, add1, add2, add3,
          postcode, contact1, contact2, contact3, reg_type, status, created
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
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
          contact3 || null,
          reg_type
        ]
      );

      // Get the created user (without password)
      const [newUser] = await this.pool.query(
        `SELECT id, first_name, sur_name, email, add1, add2, add3,
         postcode, contact1, contact2, contact3, reg_type, status, created
         FROM users WHERE id = ?`,
        [result.insertId]
      );

      // Generate tokens
      const token = generateToken(newUser[0]);
      const refreshToken = generateRefreshToken(newUser[0]);

      // Send registration email (async, don't wait)
      sendRegistrationEmail({
        email: newUser[0].email,
        first_name: newUser[0].first_name,
        sur_name: newUser[0].sur_name
      }, this.pool).catch(err => {
        console.error('Failed to send registration email:', err);
      });

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: newUser[0],
          token,
          refreshToken
        }
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
        'INSERT INTO email_verification_otps (user_id, email, otp, purpose, expires_at) VALUES (?, ?, ?, ?, ?)',
        [user.id, email, otp, otpPurpose, expiresAt]
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
         postcode, contact1, contact2, contact3, reg_type, status, created
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

      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
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
          refreshToken
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
         postcode, contact1, contact2, contact3, reg_type, status, created, modified
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
        'UPDATE users SET password = ?, modified = NOW() WHERE id = ?',
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