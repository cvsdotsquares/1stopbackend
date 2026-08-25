const proxyaddr = require('proxy-addr');

const CLOUDFLARE_V4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  let value = ip.trim().replace(/^\[|\]$/g, '');
  if (value.startsWith('::ffff:')) value = value.slice(7);
  if (value === '::1') value = '127.0.0.1';
  const withPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (withPort) value = withPort[1];
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
    ip.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function parseTrustProxyEnv(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

/**
 * Express `trust proxy` setting.
 * Trusts loopback, private networks, Cloudflare, plus optional TRUST_PROXY
 * IPs (comma-separated), e.g. the public address of nginx in front of Node.
 */
function getTrustProxySetting() {
  const fromEnv = parseTrustProxyEnv(process.env.TRUST_PROXY);
  if (fromEnv === true || fromEnv === false || typeof fromEnv === 'number') {
    return fromEnv;
  }

  const proxies = ['loopback', 'linklocal', 'uniquelocal', ...CLOUDFLARE_V4];
  if (Array.isArray(fromEnv)) proxies.push(...fromEnv);
  return proxyaddr.compile(proxies);
}

function getClientIp(req) {
  const expressIp = normalizeIp(req.ip || '');
  if (expressIp && !isPrivateOrLocal(expressIp)) return expressIp;

  const realIp = normalizeIp(req.headers['x-real-ip']);
  if (realIp && !isPrivateOrLocal(realIp)) return realIp;

  if (expressIp) return expressIp;
  return normalizeIp(req.socket?.remoteAddress || '') || 'unknown';
}

module.exports = {
  getClientIp,
  getTrustProxySetting,
  normalizeIp,
  isPrivateOrLocal,
};
