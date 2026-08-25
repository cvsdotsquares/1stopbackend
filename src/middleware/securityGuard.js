const { getClientIp } = require('../utils/clientIp');
const { bodyContainsMaliciousPayload } = require('../utils/injectionGuard');
const rateLimitUtil = require('../utils/securityRateLimit');
const { verifyRecaptchaToken } = require('../utils/recaptcha');

function createSecurityGuard(pool) {
  async function rejectMaliciousBody(req, res, next) {
    try {
      if (bodyContainsMaliciousPayload(req.body)) {
        const ip = getClientIp(req);
        await rateLimitUtil.block(pool, ip, 'abuse', 24 * 60 * 60);
        console.warn('[SECURITY] blocked malicious payload', {
          ip,
          path: req.originalUrl || req.path,
        });
        return res.status(400).json({
          success: false,
          message: 'Your request could not be processed.',
        });
      }
    } catch (error) {
      console.error('[SECURITY] injection guard error:', error.message);
    }
    return next();
  }

  function rateLimit(actionType) {
    return async (req, res, next) => {
      try {
        const ip = getClientIp(req);
        const result = await rateLimitUtil.consume(pool, ip, actionType);
        if (!result.allowed) {
          const retryAfter = result.retryAfterSeconds || 60;
          console.warn('[SECURITY] rate limited', {
            ip,
            actionType,
            retryAfter,
            xff: req.headers['x-forwarded-for'] || null,
            realIp: req.headers['x-real-ip'] || null,
            cf: req.headers['cf-connecting-ip'] || null,
            socket: req.socket?.remoteAddress || null,
          });
          res.set('Retry-After', String(retryAfter));
          return res.status(429).json({
            success: false,
            message: 'Too many requests. Please try again later.',
            retryAfter,
          });
        }
      } catch (error) {
        console.error('[SECURITY] rate limit error:', error.message);
      }
      return next();
    };
  }

  function verifyRecaptcha({ required = true } = {}) {
    return async (req, res, next) => {
      try {
        const secret = process.env.RECAPTCHA_SECRET_KEY;
        if (!secret) {
          return next();
        }

        const token = req.body?.recaptchaToken || req.body?.recaptchaToken || req.body?.recaptcha_token || '';
        if (!token) {
          if (required) {
            return res.status(400).json({
              success: false,
              message: 'Verification failed. Please refresh the page and try again.',
            });
          }
          return next();
        }

        const ip = getClientIp(req);
        const result = await verifyRecaptchaToken(token, ip);
        if (!result.success) {
          console.warn('[SECURITY] reCAPTCHA rejected', {
            path: req.originalUrl || req.path,
            error: result.error || null,
            errorCodes: result.errorCodes || [],
            score: result.score,
          });
          return res.status(400).json({
            success: false,
            message: 'Verification failed. Please refresh the page and try again.',
          });
        }
      } catch (error) {
        console.error('[SECURITY] recaptcha middleware error:', error.message);
      }
      return next();
    };
  }

  return {
    rejectMaliciousBody,
    rateLimit,
    verifyRecaptcha,
  };
}

module.exports = createSecurityGuard;
