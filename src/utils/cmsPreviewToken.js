const crypto = require('crypto');

const DEFAULT_TTL_SEC = 60 * 60;

function getPreviewSecret() {
  return (
    process.env.CMS_PREVIEW_KEY ||
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    ''
  );
}

function createCmsPreviewToken(pageId, ttlSeconds = DEFAULT_TTL_SEC) {
  const id = Number(pageId);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  const secret = getPreviewSecret();
  if (!secret) {
    return null;
  }
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSeconds) || DEFAULT_TTL_SEC);
  const payload = `${id}:${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${exp}.${sig}`;
}

function verifyCmsPreviewToken(pageId, token) {
  const id = Number(pageId);
  if (!Number.isFinite(id) || id <= 0 || !token) {
    return false;
  }
  const secret = getPreviewSecret();
  if (!secret) {
    return false;
  }
  const parts = String(token).split('.');
  if (parts.length !== 2) {
    return false;
  }
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const payload = `${id}:${exp}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[1]));
  } catch {
    return false;
  }
}

module.exports = {
  createCmsPreviewToken,
  verifyCmsPreviewToken,
};
