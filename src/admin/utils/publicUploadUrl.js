const { getRequestBaseUrl } = require('./siteUrl');

function trimTrailingSlash(value) {
  return String(value).trim().replace(/\/+$/, '');
}

function getPublicFilesBase(req) {
  for (const key of ['PUBLIC_FILES_URL']) {
    const value = process.env[key];
    if (value && String(value).trim()) {
      return trimTrailingSlash(value);
    }
  }
  const fromRequest = getRequestBaseUrl(req);
  if (fromRequest) {
    return fromRequest;
  }
  for (const key of ['API_PUBLIC_URL']) {
    const value = process.env[key];
    if (value && String(value).trim()) {
      return trimTrailingSlash(value);
    }
  }
  return '';
}

/**
 * Normalize DB `image` column → URL path under /uploads/…
 */
function normalizeUploadPath(stored, defaultSubdir) {
  if (!stored) return null;
  let s = String(stored).trim().replace(/\\/g, '/');
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  s = s.replace(/^\/+/, '');
  if (s.startsWith('uploads/')) {
    return `/${s}`;
  }
  if (s.includes('/')) {
    return `/uploads/${s}`;
  }
  return `/uploads/${defaultSubdir}/${s}`;
}

function resolvePublicUploadUrl(stored, defaultSubdir, req) {
  const path = normalizeUploadPath(stored, defaultSubdir);
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = getPublicFilesBase(req);
  return base ? `${base}${path}` : path;
}

module.exports = {
  normalizeUploadPath,
  resolvePublicUploadUrl,
  getPublicFilesBase,
};
