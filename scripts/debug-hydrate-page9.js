require('../src/loadEnv');
const mysql = require('mysql2/promise');
const registry = require('../src/admin/services/pageSections/registry');

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [instances] = await pool.query(
    `SELECT id, section_type, content_id FROM cms_section_instances
     WHERE page_id = 9 AND deleted_at IS NULL ORDER BY sort_order, id`
  );

  for (const inst of instances) {
    try {
      const data = await registry.getHandler(inst.section_type).load(pool, inst.content_id);
      console.log(
        inst.id,
        inst.section_type,
        'content',
        inst.content_id,
        data ? 'OK keys=' + Object.keys(data).length : 'NULL'
      );
    } catch (err) {
      console.log(inst.id, inst.section_type, 'ERR', err.message);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
