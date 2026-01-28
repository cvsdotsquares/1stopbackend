// src/controllers/auth.js
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { generateToken, generateRefreshToken } = require('../middleware/auth');

class AuthController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Register new user
   */
  async register(req, res) {
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

      const {
        firstName,
        surname,
        email,
        password,
        addressLine1,
        addressLine2,
        addressLine3,
        postcode,
        contactNumber1,
        contactNumber2,
        contactNumber3,
        reg_type = 'm' // 'm' for member, 'a' for admin
      } = req.body;

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
          first_name, sur_name, email, password, add1, add2, add3,
          postcode, contact1, contact2, contact3, reg_type, status, created
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
        [
          first_name,
          sur_name,
          email,
          hashedPassword,
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
   * Login user
   */
  async login(req, res) {
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

      const { email, password } = req.body;

      // Find user by email
      const [users] = await this.pool.query(
        `SELECT id, first_name, sur_name, email, password, add1, add2, add3,
         postcode, contact1, contact2, contact3, reg_type, status, created
         FROM users WHERE email = ? AND status = 1`,
        [email]
      );

      if (users.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      const user = users[0];

      // Check password
      const isPasswordValid = await bcrypt.compare(password, user.password);
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
      const { currentPassword, newPassword } = req.body;

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