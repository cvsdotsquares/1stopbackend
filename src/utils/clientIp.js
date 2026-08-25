function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  let value = ip.trim();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  if (value === '::1') value = '127.0.0.1';
  return value.slice(0, 45);
}

function isPrivateOrLocal(ip) {
  return (
    !ip ||
    ip === 'unknown' ||
    ip === '127.0.0.1' ||
    ip === 'localhost' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

/**
 * Prefer the real client IP. X-Forwarded-For is only trusted when the
 * socket address is a reverse proxy (localhost / private network), so
 * attackers cannot rotate fake forwarded IPs by hitting Node directly.
 */
function getClientIp(req) {
  const socketIp = normalizeIp(
    req.socket?.remoteAddress || req.connection?.remoteAddress || ''
  );
  const cf = normalizeIp(req.headers['cf-connecting-ip']);
  if (cf) return cf;

  const forwarded = req.headers['x-forwarded-for'];
  const forwardedFirst = typeof forwarded === 'string'
    ? normalizeIp(forwarded.split(',')[0])
    : '';

  if (forwardedFirst && isPrivateOrLocal(socketIp)) {
    return forwardedFirst;
  }

  if (socketIp) return socketIp;
  if (req.clientIp) return normalizeIp(String(req.clientIp));
  return forwardedFirst || 'unknown';
}

module.exports = {
  getClientIp,
  normalizeIp,
};
