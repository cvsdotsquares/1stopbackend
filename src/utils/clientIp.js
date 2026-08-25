const os = require('os');

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

let ownIpsCache = { at: 0, ips: new Set() };

function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  let value = ip.trim().replace(/^\[|\]$/g, '');
  if (value.startsWith('::ffff:')) value = value.slice(7);
  if (value === '::1') value = '127.0.0.1';
  const withPort = value.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (withPort) value = withPort[1];
  return value.slice(0, 45);
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt == null || rangeInt == null) return false;
  const shift = 32 - Number(bits);
  const mask = shift >= 32 ? 0 : (~0 << shift) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
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

function isCloudflareIp(ip) {
  return CLOUDFLARE_V4.some((cidr) => inCidr(ip, cidr));
}

function getOwnIps() {
  if (Date.now() - ownIpsCache.at < 60000) return ownIpsCache.ips;
  const ips = new Set(['127.0.0.1', '::1', 'localhost']);
  const ifaces = os.networkInterfaces();
  Object.values(ifaces).forEach((addrs) => {
    (addrs || []).forEach((addr) => {
      const ip = normalizeIp(addr.address);
      if (ip) ips.add(ip);
    });
  });
  ownIpsCache = { at: Date.now(), ips };
  return ips;
}

function parseForwardedChain(header) {
  if (typeof header !== 'string' || !header.trim()) return [];
  return header
    .split(',')
    .map((part) => normalizeIp(part))
    .filter(Boolean);
}

function isServerIp(ip, ownIps, extra) {
  if (!ip) return false;
  if (ownIps.has(ip)) return true;
  return extra.includes(ip);
}

function isVisitorIp(ip, ownIps, extra) {
  return Boolean(ip) && !isPrivateOrLocal(ip) && !isServerIp(ip, ownIps, extra);
}

/**
 * Real visitor IP.
 *
 * Direct public connections use the TCP peer and ignore spoofable headers.
 * Connections from localhost / a private reverse proxy may use X-Real-IP,
 * X-Forwarded-For (right-most public hop), or CF-Connecting-IP — but never
 * this machine's own addresses, which is how the server IP was being stored.
 */
function getClientIp(req) {
  const socketIp = normalizeIp(
    req.socket?.remoteAddress || req.connection?.remoteAddress || ''
  );
  const localIp = normalizeIp(req.socket?.localAddress || '');
  const ownIps = getOwnIps();
  if (localIp) ownIps.add(localIp);

  const extraServerIps = parseForwardedChain(process.env.SERVER_PUBLIC_IPS || '');
  const realIp = normalizeIp(req.headers['x-real-ip']);
  const cfIp = normalizeIp(req.headers['cf-connecting-ip']);
  const forwarded = parseForwardedChain(req.headers['x-forwarded-for']);
  const behindTrustedProxy = isPrivateOrLocal(socketIp);
  const behindCloudflare = isCloudflareIp(socketIp);

  const pickVisitor = (ip) => (isVisitorIp(ip, ownIps, extraServerIps) ? ip : '');

  if (behindTrustedProxy || behindCloudflare) {
    const fromReal = pickVisitor(realIp);
    if (fromReal) return fromReal;

    for (let i = forwarded.length - 1; i >= 0; i -= 1) {
      const fromForwarded = pickVisitor(forwarded[i]);
      if (fromForwarded) return fromForwarded;
    }

    const fromCf = pickVisitor(cfIp);
    if (fromCf) return fromCf;
  }

  if (pickVisitor(socketIp)) return socketIp;
  if (socketIp) return socketIp;
  return 'unknown';
}

module.exports = {
  getClientIp,
  normalizeIp,
  isPrivateOrLocal,
};
