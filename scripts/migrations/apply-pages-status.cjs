/**
 * Adds pages.status when missing (idempotent).
 * Usage: node scripts/migrations/apply-pages-status.cjs
 */
require('../../src/loadEnv');
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [cols] = await pool.query("SHOW COLUMNS FROM pages LIKE 'status'");
  if (cols.length) {
    console.log('pages.status already exists');
    await pool.end();
    return;
  }

  await pool.query(`
    ALTER TABLE pages
      ADD COLUMN status TINYINT(1) NOT NULL DEFAULT 1
      COMMENT '1=published on site, 0=draft (preview only)'
  `);
  console.log('Added pages.status (existing rows default to published)');
  await pool.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
