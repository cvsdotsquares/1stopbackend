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
  let value = ip.trim().replace(/^["']|["']$/g, '').replace(/^\[|\]$/g, '');
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
  const value = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!value) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(',').map((part) => normalizeIp(part)).filter(Boolean);
}

function getTrustProxyList() {
  const fromEnv = parseTrustProxyEnv(process.env.TRUST_PROXY);
  if (fromEnv === true || fromEnv === false || typeof fromEnv === 'number') {
    return fromEnv;
  }
  const extra = Array.isArray(fromEnv) ? fromEnv : [];
  return ['loopback', 'linklocal', 'uniquelocal', ...CLOUDFLARE_V4, ...extra];
}

function getTrustProxySetting() {
  return getTrustProxyList();
}

let trustFn;
function getTrustFn() {
  if (trustFn) return trustFn;
  const setting = getTrustProxyList();
  if (setting === true) trustFn = () => true;
  else if (setting === false) trustFn = () => false;
  else if (typeof setting === 'number') trustFn = (_addr, i) => i < setting;
  else trustFn = proxyaddr.compile(setting);
  return trustFn;
}

function isTrustedAddress(ip) {
  const value = normalizeIp(ip);
  if (!value) return true;
  if (isPrivateOrLocal(value)) return true;
  try {
    return Boolean(getTrustFn()(value));
  } catch {
    return false;
  }
}

function headerList(req, name) {
  const raw = req.headers[name];
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((part) => normalizeIp(part))
    .filter(Boolean);
}

function firstUntrustedPublic(ips) {
  const publicIps = ips.filter((ip) => ip && !isPrivateOrLocal(ip) && !isTrustedAddress(ip));
  return publicIps.length ? publicIps[publicIps.length - 1] : '';
}

/**
 * Visitor IP. Never returns a trusted proxy/origin address such as
 * 172.236.21.167 — that was still winning via req.ip / X-Real-IP after
 * TRUST_PROXY was set.
 */
function getClientIp(req) {
  const fromForwarded = firstUntrustedPublic(headerList(req, 'x-forwarded-for'));
  if (fromForwarded) return fromForwarded;

  const fromReal = firstUntrustedPublic(headerList(req, 'x-real-ip'));
  if (fromReal) return fromReal;

  const fromCf = firstUntrustedPublic(headerList(req, 'cf-connecting-ip'));
  if (fromCf) return fromCf;

  const fromExpress = firstUntrustedPublic([normalizeIp(req.ip || '')]);
  if (fromExpress) return fromExpress;

  const socketIp = normalizeIp(req.socket?.remoteAddress || '');
  const fromSocket = firstUntrustedPublic([socketIp]);
  if (fromSocket) return fromSocket;

  return socketIp || 'unknown';
}

module.exports = {
  getClientIp,
  getTrustProxySetting,
  normalizeIp,
  isPrivateOrLocal,
};
