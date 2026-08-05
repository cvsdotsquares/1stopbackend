require('../src/loadEnv');
const mysql = require('mysql2/promise');
const { getEditor } = require('../src/admin/services/pageSections/editorService');
const { syncPageJunction } = require('../src/admin/services/pageSections/junctionSync');
const { addSection, softDeleteInstance, restoreInstance } = require('../src/admin/services/pageSections/instanceService');

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
  });

  const [counts] = await pool.query('SELECT COUNT(*) AS c FROM cms_section_instances');
  const [j] = await pool.query(
    "SELECT COUNT(*) AS c FROM page_junction WHERE data_type = 'page'"
  );
  console.log('instances', counts[0].c, 'junction_page', j[0].c);

  const ed = await getEditor(pool, 9);
  console.log(
    'editor_ok',
    ed.ok,
    'sections',
    ed.data?.sections?.length,
    'types',
    ed.data?.section_types?.length
  );
  console.log(
    'first',
    ed.data?.sections?.[0]?.type,
    ed.data?.sections?.[0]?.title,
    'hasData',
    Boolean(ed.data?.sections?.[0]?.data)
  );

  // Sample simple section hydrate
  const banner = ed.data?.sections?.find((s) => s.type === 'page_banner');
  if (banner) {
    console.log('banner keys', Object.keys(banner.data || {}).slice(0, 8));
  }

  const nested = ed.data?.sections?.find((s) => s.type === 'direct_access');
  if (nested) {
    console.log(
      'direct_access images',
      Array.isArray(nested.data?.images) ? nested.data.images.length : 0
    );
  }

  const slider = ed.data?.sections?.find((s) => s.type === 'home_slider');
  if (slider) {
    console.log(
      'home_slider images',
      Array.isArray(slider.data?.images) ? slider.data.images.length : 0,
      'box',
      Boolean(slider.data?.box)
    );
  }

  await syncPageJunction(pool, 9, 'page');
  const [j2] = await pool.query(
    "SELECT COUNT(*) AS c FROM page_junction WHERE data_id = 9 AND data_type = 'page'"
  );
  const [i2] = await pool.query(
    `SELECT COUNT(*) AS c FROM cms_section_instances
     WHERE page_id = 9 AND deleted_at IS NULL AND is_enabled = 1 AND status = 'published'`
  );
  console.log('page9 junction', j2[0].c, 'enabled published instances', i2[0].c);

  // Add/remove smoke on a throwaway page if available — use page with few sections
  // Soft-delete then restore first non-single-use section on page 9 if safe... skip mutating home.
  // Instead just validate add handler createEmpty for page_banner on a temp path via create+purge.
  const add = await addSection(pool, 9, 'page_banner');
  if (!add.ok) {
    console.log('add_banner_failed', add.message);
  } else {
    console.log('add_banner_ok', add.data.id, add.data.content_id);
    await softDeleteInstance(pool, 9, add.data.id);
    const restored = await restoreInstance(pool, 9, add.data.id);
    console.log('restore_ok', restored.ok);
    // purge permanently so we don't leave junk
    const { purgeInstance } = require('../src/admin/services/pageSections/instanceService');
    await purgeInstance(pool, 9, add.data.id);
    console.log('purged_test_banner');
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
