require('../src/loadEnv');
const mysql = require('mysql2/promise');

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [cols] = await pool.query('DESCRIBE page_junction');
  console.log('page_junction columns:');
  cols.forEach((c) => console.log(`  ${c.Field}: ${c.Type}`));

  const [sections] = await pool.query(
    'SELECT id, title, title_slug, is_active, sort_order FROM page_sections ORDER BY sort_order'
  );
  console.log('page_sections:', JSON.stringify(sections, null, 2));

  const [cnt] = await pool.query(
    "SELECT COUNT(*) AS n FROM page_junction WHERE data_type = 'page'"
  );
  console.log('page junction count:', cnt[0].n);

  const [sample] = await pool.query(
    "SELECT * FROM page_junction WHERE data_type = 'page' ORDER BY id LIMIT 5"
  );
  console.log('sample junction:', JSON.stringify(sample, null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
