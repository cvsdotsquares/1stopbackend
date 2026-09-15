const axios = require('axios');

async function verifyRecaptchaToken(token, remoteIp) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    return { skipped: true, success: true, score: 1 };
  }

  if (!token) {
    return { skipped: false, success: false, score: 0, error: 'missing_token' };
  }

  const minScore = Number.parseFloat(process.env.RECAPTCHA_MIN_SCORE || '0.5');

  try {
    const { data } = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      null,
      {
        params: {
          secret,
          response: token,
          remoteip: remoteIp || undefined,
        },
        timeout: 5000,
      }
    );

    const score = typeof data.score === 'number' ? data.score : 1;
    const success = Boolean(data.success) && score >= minScore;

    return {
      skipped: false,
      success,
      score,
      action: data.action || null,
      hostname: data.hostname || null,
      errorCodes: data['error-codes'] || [],
    };
  } catch (error) {
    console.error('[SECURITY] reCAPTCHA verify failed:', error.message);
    // Fail open on Google/network errors; IP rate limiting still applies.
    return { skipped: true, success: true, score: 0, error: 'verify_failed' };
  }
}

module.exports = {
  verifyRecaptchaToken,
};
