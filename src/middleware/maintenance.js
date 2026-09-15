// src/middleware/maintenance.js
//
// Express middleware that mirrors the frontend maintenance gate
// (1stopfrontend/src/middleware.ts). When MAINTENANCE_MODE is "true" every
// request is short-circuited with HTTP 503, except for:
//
//   - explicitly allow-listed paths (health checks, Stripe webhook),
//   - clients whose IP is in MAINTENANCE_ALLOWED_IPS,
//   - clients that send the correct bypass token via either the
//     `X-Maintenance-Bypass` header or `?maintenance_bypass=` query string.
//
// Env vars (all server-only, read at request time so toggling MAINTENANCE_MODE
// on a running process takes effect immediately):
//
//   MAINTENANCE_MODE          "true" to enable the gate
//   MAINTENANCE_BYPASS_TOKEN  shared secret accepted via header / query
//   MAINTENANCE_ALLOWED_IPS   comma-separated list of exact IPs / wildcard
//                             patterns (e.g. "10.0.*.*, 203.0.113.42")
//
// Mount this AFTER the `req.clientIp` middleware in src/index.js but BEFORE
// any business routes.

const RETRY_AFTER_SECONDS = 60 * 30; // 30 min

/**
 * Paths that must always respond, even during a maintenance window.
 *
 *   - /health, /db-test     monitoring
 *   - /api/webhook          Stripe webhooks — dropping these can cause
 *                           payment events to be lost permanently
 */
const ALWAYS_ALLOWED_PREFIXES = [
  '/health',
  '/db-test',
  '/api/webhook',
];

function isMaintenanceModeEnabled() {
  return String(process.env.MAINTENANCE_MODE || '').toLowerCase() === 'true';
}

function isPathAlwaysAllowed(pathname) {
  return ALWAYS_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
  );
}

function ipMatchesPattern(ip, pattern) {
  const trimmed = String(pattern || '').trim();
  if (!trimmed) return false;
  if (trimmed === ip) return true;

  if (trimmed.includes('*')) {
    const regex = new RegExp(
      '^' +
        trimmed
          .split('.')
          .map((octet) =>
            octet === '*' ? '[^.]+' : octet.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          )
          .join('\\.') +
        '$'
    );
    return regex.test(ip);
  }
  return false;
}

function isIpWhitelisted(ip) {
  if (!ip) return false;
  const raw = process.env.MAINTENANCE_ALLOWED_IPS || '';
  if (!raw.trim()) return false;
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .some((pattern) => ipMatchesPattern(ip, pattern));
}

function hasValidBypassToken(req) {
  const expected = process.env.MAINTENANCE_BYPASS_TOKEN || '';
  if (!expected) return false;

  const headerToken = req.headers['x-maintenance-bypass'];
  if (typeof headerToken === 'string' && headerToken === expected) return true;

  const queryToken = req.query && req.query.maintenance_bypass;
  if (typeof queryToken === 'string' && queryToken === expected) return true;

  return false;
}

/**
 * @returns Express middleware function
 */
function createMaintenanceMiddleware() {
  return function maintenanceMiddleware(req, res, next) {
    // Always echo the IP we used so it's easy to debug "why didn't my
    // whitelist match?" from a curl -i.
    if (req.clientIp) {
      res.setHeader('X-Maintenance-Detected-IP', req.clientIp);
    }

    if (!isMaintenanceModeEnabled()) {
      return next();
    }

    if (isPathAlwaysAllowed(req.path)) {
      return next();
    }

    if (isIpWhitelisted(req.clientIp)) {
      return next();
    }

    if (hasValidBypassToken(req)) {
      return next();
    }

    res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    return res.status(503).json({
      success: false,
      code: 'MAINTENANCE_MODE',
      message: 'The service is temporarily unavailable for scheduled maintenance. Please try again shortly.',
    });
  };
}

module.exports = {
  createMaintenanceMiddleware,
  // Exported for unit tests / future reuse:
  isMaintenanceModeEnabled,
  isPathAlwaysAllowed,
  isIpWhitelisted,
  ipMatchesPattern,
};
