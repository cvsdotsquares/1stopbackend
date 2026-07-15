function trimTrailingSlash(value) {
  return String(value).trim().replace(/\/+$/, '');
}

function getRequestBaseUrl(req) {
  if (!req) {
    return '';
  }

  const protoHeader = req.get('x-forwarded-proto');
  const proto = protoHeader
    ? String(protoHeader).split(',')[0].trim()
    : req.protocol || 'http';

  const hostHeader = req.get('x-forwarded-host') || req.get('host');
  const host = hostHeader ? String(hostHeader).split(',')[0].trim() : '';

  if (!host) {
    return '';
  }

  return trimTrailingSlash(`${proto}://${host}`);
}

function getSiteUrl(req) {
  for (const key of ['FRONT_SITE_URL', 'SITE_URL']) {
    const value = process.env[key];
    if (value && String(value).trim()) {
      return trimTrailingSlash(value);
    }
  }

  const origin = req?.get('origin');
  if (origin && String(origin).trim()) {
    return trimTrailingSlash(origin);
  }

  return getRequestBaseUrl(req);
}

module.exports = {
  getSiteUrl,
  getRequestBaseUrl,
};
