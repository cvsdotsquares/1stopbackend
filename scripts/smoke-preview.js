/**
 * Smoke QA for Save & Preview APIs.
 * Usage: node scripts/smoke-preview.js
 */
require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local', override: true });

const mysql = require('mysql2/promise');
const {
  createPreviewToken,
  verifyPreviewToken,
} = require('../src/utils/pagePreviewToken');

const API = `http://127.0.0.1:${process.env.PORT || 3000}/api`;

async function getJson(url) {
  const res = await fetch(url);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: String(process.env.DB_NAME || '').trim(),
    connectionLimit: 2,
  });

  const results = [];

  // Unit: token verify
  const minted = createPreviewToken(99);
  results.push({
    name: 'token valid for page',
    ok: verifyPreviewToken(minted.token, 99) === true,
  });
  results.push({
    name: 'token rejects wrong page',
    ok: verifyPreviewToken(minted.token, 100) === false,
  });

  // Find a page with no menu row
  const [noMenu] = await pool.query(`
    SELECT p.id, p.slug
    FROM pages p
    LEFT JOIN page_menus pm ON pm.page_link_id = p.id
    WHERE pm.id IS NULL
    ORDER BY p.id DESC
    LIMIT 1
  `);

  // Find a page with a menu row
  const [withMenu] = await pool.query(`
    SELECT p.id, p.slug, pm.page_slug
    FROM pages p
    INNER JOIN page_menus pm ON pm.page_link_id = p.id
    WHERE pm.page_slug IS NOT NULL AND pm.page_slug <> ''
    ORDER BY p.id DESC
    LIMIT 1
  `);

  if (!noMenu.length) {
    results.push({ name: 'find no-menu page', ok: false, detail: 'none found' });
  } else {
    const page = noMenu[0];
    const slugPath = String(page.slug || '').replace(/^\/+/, '');
    const slugRes = await getJson(`${API}/cmspages/${encodeURIComponent(slugPath || '___missing___')}`);
    results.push({
      name: 'no-menu slug returns 404',
      ok: slugRes.status === 404 || slugRes.body?.success === false,
      detail: { id: page.id, slug: page.slug, status: slugRes.status },
    });

    const { token } = createPreviewToken(page.id);
    const previewOk = await getJson(
      `${API}/cmspages/preview/${page.id}?token=${encodeURIComponent(token)}`
    );
    results.push({
      name: 'valid token preview returns page',
      ok:
        previewOk.status === 200 &&
        previewOk.body?.success === true &&
        Number(previewOk.body?.data?.id) === Number(page.id),
      detail: {
        status: previewOk.status,
        id: previewOk.body?.data?.id,
        sections: previewOk.body?.data?.sections?.length,
      },
    });

    const previewNoToken = await getJson(`${API}/cmspages/preview/${page.id}`);
    results.push({
      name: 'missing token preview 404',
      ok: previewNoToken.status === 404 || previewNoToken.body?.success === false,
      detail: { status: previewNoToken.status },
    });

    // Expired token: craft with past exp
    const crypto = require('crypto');
    const secret =
      process.env.CMS_PREVIEW_SECRET ||
      process.env.SESSION_SECRET ||
      process.env.JWT_SECRET ||
      'change-me-in-production';
    const exp = Math.floor(Date.now() / 1000) - 60;
    const b64 = (s) =>
      Buffer.from(String(s))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
    const sig = crypto
      .createHmac('sha256', secret)
      .update(`preview.${page.id}.${exp}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const expiredToken = `${b64(page.id)}.${b64(exp)}.${sig}`;
    const expiredRes = await getJson(
      `${API}/cmspages/preview/${page.id}?token=${encodeURIComponent(expiredToken)}`
    );
    results.push({
      name: 'expired token preview 404',
      ok: expiredRes.status === 404 || expiredRes.body?.success === false,
      detail: { status: expiredRes.status },
    });
  }

  if (!withMenu.length) {
    results.push({ name: 'find menu-linked page', ok: false, detail: 'none found' });
  } else {
    const page = withMenu[0];
    const menuSlug = String(page.page_slug).replace(/^\/+/, '');
    const encoded = menuSlug
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    const slugRes = await getJson(`${API}/cmspages/${encoded}`);
    results.push({
      name: 'menu-linked slug still works',
      ok:
        slugRes.status === 200 &&
        slugRes.body?.success === true &&
        Number(slugRes.body?.data?.id) === Number(page.id),
      detail: {
        menuSlug,
        status: slugRes.status,
        id: slugRes.body?.data?.id,
      },
    });
  }

  await pool.end();

  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    if (!r.ok) failed += 1;
    console.log(`${mark}  ${r.name}`, r.detail ? JSON.stringify(r.detail) : '');
  }
  console.log(failed === 0 ? '\nAll QA checks passed.' : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
