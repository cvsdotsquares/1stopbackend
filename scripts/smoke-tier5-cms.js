/**
 * Tier 5 CMS smoke test (local dev).
 * Usage: node scripts/smoke-tier5-cms.js
 * Optional: SMOKE_ADMIN_USER / SMOKE_ADMIN_PASS override DB lookup.
 */
require('../src/loadEnv');

const mysql = require('mysql2/promise');
const {
  mc_decrypt,
  mc_decrypt_old,
} = require('../src/utils/universalPassword');

const API = (process.env.SMOKE_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const FE = (process.env.SMOKE_FE_URL || 'http://localhost:3001').replace(/\/$/, '');

const API_CHECKS = [
  { name: 'testimonials list', path: '/api/admin/testimonials?page=1&limit=5' },
  { name: 'accreditations list', path: '/api/admin/accreditations?page=1&limit=5' },
  { name: 'carousel list', path: '/api/admin/carousel?page=1&limit=5' },
  { name: 'contacts list', path: '/api/admin/contacts?page=1&limit=5' },
  { name: 'footer images list', path: '/api/admin/footer-images?page=1&limit=5' },
  { name: 'page menus tree', path: '/api/admin/page-menus/tree' },
  { name: 'faqs list', path: '/api/admin/faqs?page=1&limit=5' },
  { name: 'location-course list', path: '/api/admin/location-course-pages?page=1&limit=5' },
  { name: 'location-course new editor', path: '/api/admin/location-course-pages/new/editor' },
  { name: 'footer manager', path: '/api/admin/footer' },
  { name: 'training data', path: '/api/admin/training-data' },
  { name: 'external css', path: '/api/admin/external-css' },
  { name: 'files list', path: '/api/admin/files' },
  { name: 'featured services list', path: '/api/admin/featured-services?page=1&limit=5' },
];

const FE_ROUTES = [
  '/admin/testimonials',
  '/admin/testimonials/new',
  '/admin/accreditations',
  '/admin/carousel',
  '/admin/contacts',
  '/admin/footer-images',
  '/admin/page-menus',
  '/admin/faqs',
  '/admin/faqs/new',
  '/admin/location-course-pages',
  '/admin/location-course-pages/new',
  '/admin/footer',
  '/admin/external-css',
  '/admin/files',
  '/admin/featured-services',
  '/admin/training-data',
];

function getEncryptionKey() {
  return process.env.UNIVERSAL_PASSWORD_KEY || process.env.ENCRYPTION_KEY;
}

function decryptAdminPassword(raw, keyHex) {
  let pass = mc_decrypt_old(raw, keyHex);
  if (pass === false) pass = mc_decrypt(raw, keyHex);
  return pass;
}

function parseSetCookie(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie().map((c) => c.split(';')[0]);
  }
  const single = res.headers.get('set-cookie');
  if (!single) return [];
  return single.split(/,(?=[^;]+?=)/).map((c) => c.split(';')[0].trim());
}

async function resolveAdminCredentials(pool) {
  if (process.env.SMOKE_ADMIN_USER && process.env.SMOKE_ADMIN_PASS) {
    return {
      user: process.env.SMOKE_ADMIN_USER,
      pass: process.env.SMOKE_ADMIN_PASS,
    };
  }
  const keyHex = getEncryptionKey();
  if (!keyHex) {
    throw new Error('ENCRYPTION_KEY / UNIVERSAL_PASSWORD_KEY not configured');
  }
  const [rows] = await pool.query(
    'SELECT admin_username, admin_pass FROM admin WHERE status = 1 ORDER BY admin_id ASC LIMIT 1'
  );
  if (!rows?.length) {
    throw new Error('No active admin row in database');
  }
  const pass = decryptAdminPassword(rows[0].admin_pass, keyHex);
  if (pass === false || !pass) {
    throw new Error('Could not decrypt admin password for smoke login');
  }
  return { user: rows[0].admin_username, pass };
}

async function login(cookieJar) {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 2,
  });
  try {
    const { user, pass } = await resolveAdminCredentials(pool);
    const res = await fetch(`${API}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      throw new Error(body.message || `Login failed (${res.status})`);
    }
    for (const part of parseSetCookie(res)) {
      cookieJar.push(part);
    }
    return user;
  } finally {
    await pool.end();
  }
}

async function apiGet(path, cookieJar) {
  const res = await fetch(`${API}${path}`, {
    headers: cookieJar.length ? { Cookie: cookieJar.join('; ') } : {},
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function feGet(path) {
  const res = await fetch(`${FE}${path}`, { redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, location: res.headers.get('location') };
}

function okApi(result) {
  return result.status === 200 && result.body && result.body.success === true;
}

function okFe(result) {
  if (result.status >= 300 && result.status < 400) {
    return { ok: false, detail: `redirect ${result.status} → ${result.location}` };
  }
  if (result.status !== 200) {
    return { ok: false, detail: `HTTP ${result.status}` };
  }
  const hasShell =
    result.text.includes('admin-page') ||
    result.text.includes('admin-shell') ||
    result.text.includes('View / Edit') ||
    result.text.includes('admin-page-title');
  if (!hasShell) {
    return { ok: false, detail: 'missing expected admin UI markers' };
  }
  return { ok: true, detail: '200' };
}

async function main() {
  const cookieJar = [];
  console.log(`API base: ${API}`);
  console.log(`FE base:  ${FE}\n`);

  let username;
  try {
    username = await login(cookieJar);
    console.log(`Logged in as: ${username}\n`);
  } catch (err) {
    console.error('LOGIN FAIL:', err.message);
    process.exit(1);
  }

  if (!cookieJar.length) {
    console.error('LOGIN FAIL: no session cookie received');
    process.exit(1);
  }

  let apiFail = 0;
  console.log('--- API (authenticated) ---');
  for (const check of API_CHECKS) {
    const result = await apiGet(check.path, cookieJar);
    const pass = okApi(result);
    if (!pass) apiFail += 1;
    const msg = pass
      ? 'OK'
      : `FAIL (${result.status}) ${result.body?.message || JSON.stringify(result.body)?.slice(0, 120)}`;
    console.log(`${pass ? '✓' : '✗'} ${check.name}: ${msg}`);
  }

  let feFail = 0;
  console.log('\n--- Frontend routes ---');
  for (const route of FE_ROUTES) {
    const result = await feGet(route);
    const verdict = okFe(result);
    if (!verdict.ok) feFail += 1;
    console.log(`${verdict.ok ? '✓' : '✗'} ${route}: ${verdict.detail}`);
  }

  console.log('\n--- Summary ---');
  console.log(
    `API: ${API_CHECKS.length - apiFail}/${API_CHECKS.length} passed | FE: ${FE_ROUTES.length - feFail}/${FE_ROUTES.length} passed`
  );

  if (apiFail || feFail) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
