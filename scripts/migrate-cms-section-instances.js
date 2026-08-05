/**
 * Create cms_section_instances and migrate from page_junction.
 * Idempotent — safe to re-run.
 */
require('../src/loadEnv');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

function uuid() {
  return crypto.randomUUID();
}

const TYPE_TABLE = {
  home_slider: 'pageSliders',
  direct_access: 'direct_access',
  our_services: 'our_services',
  cheap_cbt_test_across_london: 'cbt_across_london',
  cheap_cbt_test_london: 'cbt_test_london',
  expert_training: 'expert_training_slider',
  why_1stop: 'why_1stop',
  our_exceptional: 'our_exceptional',
  page_banner: 'pages_banner',
  dynamic_content: 'dynamic_content_sections',
  directions_parking: 'tab_section',
  info_card: 'info_card_section',
  price_card: 'price_card_sections',
  service_areas: 'service_areas_section',
  accordion: 'accordion_section',
  content_cards: 'content_cards_section',
  process_steps: 'process_steps',
  cms_sidebar: 'cms_sidebar',
};

async function contentExists(pool, table, id) {
  const [rows] = await pool.query(
    `SELECT id FROM \`${table}\` WHERE id = ? LIMIT 1`,
    [id]
  );
  return Boolean(rows[0]);
}

async function resolveContentId(pool, row) {
  const type = row.section_data;
  const pageId = row.data_id;
  const table = TYPE_TABLE[type];
  const sectionId = Number(row.section_id);

  if (table && Number.isFinite(sectionId) && sectionId > 0) {
    if (await contentExists(pool, table, sectionId)) {
      return sectionId;
    }
  }

  if (!table) return null;

  // Fallback: first content row for this page (legacy often stored bogus section_id=1)
  const [rows] = await pool.query(
    `SELECT id FROM \`${table}\` WHERE page_id = ? ORDER BY id ASC LIMIT 1`,
    [pageId]
  );
  return rows[0]?.id || null;
}

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  console.log('Creating cms_section_instances if missing...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cms_section_instances (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid CHAR(36) NOT NULL,
      page_id INT UNSIGNED NOT NULL,
      data_type ENUM('page','location') NOT NULL DEFAULT 'page',
      section_type VARCHAR(64) NOT NULL,
      content_id INT UNSIGNED NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      admin_label VARCHAR(255) NULL,
      status ENUM('draft','published') NOT NULL DEFAULT 'published',
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      legacy_junction_id INT UNSIGNED NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME NULL,
      UNIQUE KEY uq_uuid (uuid),
      KEY idx_page_order (page_id, data_type, deleted_at, sort_order),
      KEY idx_type_content (section_type, content_id),
      KEY idx_legacy_junction (legacy_junction_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [existing] = await pool.query(
    'SELECT COUNT(*) AS n FROM cms_section_instances'
  );
  console.log('Existing instances:', existing[0].n);

  const [junctionRows] = await pool.query(
    "SELECT * FROM page_junction WHERE data_type IN ('page','location') ORDER BY id ASC"
  );
  console.log('Junction rows to consider:', junctionRows.length);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of junctionRows) {
    const [already] = await pool.query(
      'SELECT id FROM cms_section_instances WHERE legacy_junction_id = ? LIMIT 1',
      [row.id]
    );
    if (already.length) {
      skipped += 1;
      continue;
    }

    const contentId = await resolveContentId(pool, row);
    if (!contentId) {
      console.warn(
        `Skip junction ${row.id}: could not resolve content_id for ${row.section_data} page ${row.data_id}`
      );
      failed += 1;
      continue;
    }

    const now = new Date();
    await pool.query(
      `INSERT INTO cms_section_instances (
        uuid, page_id, data_type, section_type, content_id, sort_order,
        admin_label, status, is_enabled, legacy_junction_id, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'published', 1, ?, ?, ?, NULL)`,
      [
        uuid(),
        row.data_id,
        row.data_type || 'page',
        row.section_data,
        contentId,
        Number(row.sort_order) || 0,
        row.id,
        now,
        now,
      ]
    );
    inserted += 1;
  }

  const [finalCount] = await pool.query(
    'SELECT COUNT(*) AS n FROM cms_section_instances WHERE deleted_at IS NULL'
  );
  const [junctionCount] = await pool.query(
    "SELECT COUNT(*) AS n FROM page_junction WHERE data_type IN ('page','location')"
  );

  console.log(
    JSON.stringify(
      {
        inserted,
        skipped,
        failed,
        instances: finalCount[0].n,
        junction: junctionCount[0].n,
      },
      null,
      2
    )
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
