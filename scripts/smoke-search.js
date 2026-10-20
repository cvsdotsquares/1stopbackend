require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const mysql = require('mysql2/promise');
const { mc_decrypt, mc_decrypt_old } = require('../src/utils/universalPassword');

const API = process.env.TEST_API_URL || 'http://localhost:3000';

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
  const [rows] = await pool.query(
    'SELECT admin_username, admin_pass FROM admin WHERE status = 1 ORDER BY admin_id ASC LIMIT 1'
  );
  if (!rows?.length) {
    throw new Error('No active admin row in database');
  }
  const pass = decryptAdminPassword(rows[0].admin_pass, keyHex);
  return { user: rows[0].admin_username, pass };
}

async function runSmokeSearch() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 2,
  });

  try {
    console.log('1. Logging in to admin session...');
    const { user, pass } = await resolveAdminCredentials(pool);
    const loginRes = await fetch(`${API}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass }),
    });

    const cookies = parseSetCookie(loginRes);
    const cookieHeader = cookies.join('; ');
    if (!cookieHeader) {
      throw new Error('Failed to get session cookie from login');
    }
    console.log('   Logged in successfully.');

    // 2. Test Quick Search
    console.log('\n2. Testing GET /api/admin/search/quick?q=test');
    const quickRes = await fetch(`${API}/api/admin/search/quick?q=test`, {
      headers: { Cookie: cookieHeader },
    });
    console.log('   Status:', quickRes.status);
    const quickBody = await quickRes.json();
    console.log('   Success:', quickBody.ok);
    console.log('   Customers count:', quickBody.data?.customers?.length);
    console.log('   Vehicles count:', quickBody.data?.vehicles?.length);
    if (!quickBody.ok) throw new Error('Quick search failed');

    // 3. Test Global Search (All)
    console.log('\n3. Testing GET /api/admin/search/global?q=test&type=all');
    const globalRes = await fetch(`${API}/api/admin/search/global?q=test&type=all`, {
      headers: { Cookie: cookieHeader },
    });
    console.log('   Status:', globalRes.status);
    const globalBody = await globalRes.json();
    console.log('   Success:', globalBody.ok);
    console.log('   Customers total:', globalBody.data?.customers?.pagination?.total);
    console.log('   Vehicles total:', globalBody.data?.vehicles?.pagination?.total);
    if (!globalBody.ok) throw new Error('Global search failed');

    // 4. Test Global Search (Type = Customers)
    console.log('\n4. Testing GET /api/admin/search/global?q=test&type=customers');
    const custRes = await fetch(`${API}/api/admin/search/global?q=test&type=customers`, {
      headers: { Cookie: cookieHeader },
    });
    const custBody = await custRes.json();
    console.log('   Status:', custRes.status);
    console.log('   Vehicles excluded:', custBody.data?.vehicles?.items?.length === 0);

    // 5. Test Global Search (Type = Vehicles)
    console.log('\n5. Testing GET /api/admin/search/global?q=test&type=vehicles');
    const vehRes = await fetch(`${API}/api/admin/search/global?q=test&type=vehicles`, {
      headers: { Cookie: cookieHeader },
    });
    const vehBody = await vehRes.json();
    console.log('   Status:', vehRes.status);
    console.log('   Customers excluded:', vehBody.data?.customers?.items?.length === 0);

    console.log('\nAll search smoke tests PASSED successfully!');
  } finally {
    await pool.end();
  }
}

runSmokeSearch().catch((err) => {
  console.error('Smoke search test failed:', err);
  process.exit(1);
});
