const crypto = require('crypto');

const TTL_SECONDS = 30 * 60; // 30 minutes

function getSecret() {
  return (
    process.env.CMS_PREVIEW_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    'change-me-in-production'
  );
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64').toString('utf8');
}

function sign(pageId, exp) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(`preview.${pageId}.${exp}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * @param {number|string} pageId
 * @returns {{ token: string, expiresAt: number }}
 */
function createPreviewToken(pageId) {
  const id = Number(pageId);
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const sig = sign(id, exp);
  const token = `${base64url(String(id))}.${base64url(String(exp))}.${sig}`;
  return { token, expiresAt: exp };
}

/**
 * @param {string} token
 * @param {number|string} pageId
 * @returns {boolean}
 */
function verifyPreviewToken(token, pageId) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  let tokenPageId;
  let exp;
  try {
    tokenPageId = Number(base64urlDecode(parts[0]));
    exp = Number(base64urlDecode(parts[1]));
  } catch {
    return false;
  }

  if (!Number.isFinite(tokenPageId) || !Number.isFinite(exp)) return false;
  if (tokenPageId !== Number(pageId)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;

  const expected = sign(tokenPageId, exp);
  const provided = parts[2];
  if (expected.length !== provided.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(provided, 'utf8')
    );
  } catch {
    return false;
  }
}

module.exports = {
  createPreviewToken,
  verifyPreviewToken,
  TTL_SECONDS,
};
