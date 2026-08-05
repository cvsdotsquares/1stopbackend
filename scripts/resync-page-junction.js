/**
 * Resync page_junction from cms_section_instances for all pages (Phase E).
 */
require('../src/loadEnv');
const mysql = require('mysql2/promise');
const { syncPageJunction } = require('../src/admin/services/pageSections/junctionSync');

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [pages] = await pool.query(
    `SELECT DISTINCT page_id FROM cms_section_instances WHERE data_type = 'page'`
  );

  let synced = 0;
  for (const row of pages) {
    await syncPageJunction(pool, row.page_id, 'page');
    synced += 1;
    if (synced % 25 === 0) console.log(`Synced ${synced}/${pages.length}`);
  }

  const [mismatch] = await pool.query(`
    SELECT i.page_id,
      (SELECT COUNT(*) FROM cms_section_instances c
        WHERE c.page_id = i.page_id AND c.data_type='page' AND c.deleted_at IS NULL
          AND c.is_enabled=1 AND c.status='published') AS instances,
      (SELECT COUNT(*) FROM page_junction j
        WHERE j.data_id = i.page_id AND j.data_type='page') AS junction
    FROM (SELECT DISTINCT page_id FROM cms_section_instances WHERE data_type='page') i
    HAVING instances != junction
    LIMIT 20
  `);

  console.log(JSON.stringify({ synced, mismatches: mismatch }, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
