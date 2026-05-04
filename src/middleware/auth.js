// src/middleware/auth.js
const jwt = require('jsonwebtoken');

// JWT Secret (should be in environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Middleware to verify JWT token and authenticate user.
 *
 * Status code contract (read by the frontend response interceptor):
 *   401 NO_TOKEN        -> no Authorization header / no Bearer token
 *   401 TOKEN_EXPIRED   -> JWT was valid but its `exp` has passed
 *   401 INVALID_TOKEN   -> JWT failed signature / decoding
 *   403                 -> reserved for "authenticated but not allowed"
 *                          (e.g. requireAdmin, inactive account, etc.)
 */
const authenticateToken = (req, res, next) => {
  // Get token from header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'NO_TOKEN',
      message: 'Access token is required'
    });
  }

  // Verify token
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      const isExpired = err.name === 'TokenExpiredError';
      return res.status(401).json({
        success: false,
        code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        message: isExpired ? 'Session expired, please log in again' : 'Invalid token'
      });
    }

    // Add user info to request object
    req.user = decoded;
    next();
  });
};

/**
 * Middleware to check if user is admin
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.reg_type !== 'a') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

/**
 * Generate JWT token for user
 */
const generateToken = (user) => {
  const payload = {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    sur_name: user.sur_name,
    reg_type: user.reg_type,
    status: user.status
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  });
};

/**
 * Generate refresh token
 */
const generateRefreshToken = (user) => {
  const payload = {
    id: user.id,
    email: user.email,
    type: 'refresh'
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'
  });
};

module.exports = {
  authenticateToken,
  requireAdmin,
  generateToken,
  generateRefreshToken,
  JWT_SECRET
};