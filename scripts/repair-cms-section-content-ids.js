/**
 * Repair cms_section_instances.content_id when legacy section_id pointed at missing rows.
 */
require('../src/loadEnv');
const mysql = require('mysql2/promise');

const TYPE_TABLE = {
  home_slider: { table: 'pageSliders', pageCol: 'page_id' },
  direct_access: { table: 'direct_access', pageCol: 'page_id' },
  our_services: { table: 'our_services', pageCol: 'page_id' },
  cheap_cbt_test_across_london: { table: 'cbt_across_london', pageCol: 'page_id' },
  cheap_cbt_test_london: { table: 'cbt_test_london', pageCol: 'page_id' },
  expert_training: { table: 'expert_training_slider', pageCol: 'page_id' },
  why_1stop: { table: 'why_1stop', pageCol: 'page_id' },
  our_exceptional: { table: 'our_exceptional', pageCol: 'page_id' },
  page_banner: { table: 'pages_banner', pageCol: 'page_id' },
  dynamic_content: { table: 'dynamic_content_sections', pageCol: 'page_id' },
  directions_parking: { table: 'tab_section', pageCol: 'page_id' },
  info_card: { table: 'info_card_section', pageCol: 'page_id' },
  price_card: { table: 'price_card_sections', pageCol: 'page_id' },
  service_areas: { table: 'service_areas_section', pageCol: 'page_id' },
  accordion: { table: 'accordion_section', pageCol: 'page_id' },
  content_cards: { table: 'content_cards_section', pageCol: 'page_id' },
  process_steps: { table: 'process_steps', pageCol: 'page_id' },
  cms_sidebar: { table: 'cms_sidebar', pageCol: 'page_id' },
};

async function contentExists(pool, table, id) {
  const [rows] = await pool.query(`SELECT id FROM \`${table}\` WHERE id = ? LIMIT 1`, [id]);
  return Boolean(rows[0]);
}

function usedKey(pageId, type) {
  return `${pageId}::${type}`;
}

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [instances] = await pool.query(
    `SELECT * FROM cms_section_instances WHERE deleted_at IS NULL ORDER BY page_id, sort_order, id`
  );

  const used = new Map();
  const broken = [];
  let ok = 0;

  // Pass 1: reserve valid content ids
  for (const inst of instances) {
    const meta = TYPE_TABLE[inst.section_type];
    if (!meta) {
      broken.push(inst);
      continue;
    }
    const key = usedKey(inst.page_id, inst.section_type);
    if (!used.has(key)) used.set(key, new Set());

    const exists = await contentExists(pool, meta.table, inst.content_id);
    if (exists) {
      used.get(key).add(Number(inst.content_id));
      ok += 1;
    } else {
      broken.push(inst);
    }
  }

  let fixed = 0;
  let disabled = 0;

  // Pass 2: reassign broken instances to unused page content rows
  for (const inst of broken) {
    const meta = TYPE_TABLE[inst.section_type];
    if (!meta) {
      console.warn(`Unknown type ${inst.section_type} instance ${inst.id}`);
      continue;
    }

    const key = usedKey(inst.page_id, inst.section_type);
    if (!used.has(key)) used.set(key, new Set());
    const usedSet = used.get(key);

    const [candidates] = await pool.query(
      `SELECT id FROM \`${meta.table}\` WHERE \`${meta.pageCol}\` = ? ORDER BY id ASC`,
      [inst.page_id]
    );
    const next = (candidates || []).find((c) => !usedSet.has(Number(c.id)));

    if (next) {
      await pool.query(
        `UPDATE cms_section_instances SET content_id = ?, updated_at = NOW() WHERE id = ?`,
        [next.id, inst.id]
      );
      usedSet.add(Number(next.id));
      fixed += 1;
      console.log(
        `Fixed instance ${inst.id} ${inst.section_type} page ${inst.page_id}: ${inst.content_id} -> ${next.id}`
      );
    } else {
      await pool.query(
        `UPDATE cms_section_instances
         SET is_enabled = 0, status = 'draft', updated_at = NOW()
         WHERE id = ?`,
        [inst.id]
      );
      disabled += 1;
      console.warn(
        `Disabled orphan instance ${inst.id} ${inst.section_type} page ${inst.page_id} content ${inst.content_id}`
      );
    }
  }

  console.log(JSON.stringify({ ok, fixed, disabled, broken: broken.length }, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
