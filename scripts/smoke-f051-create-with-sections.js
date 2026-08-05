/**
 * Verify page + sections are created in one transaction (legacy add_page.php parity),
 * then clean up everything the test created.
 */
require('../src/loadEnv');
const mysql = require('mysql2/promise');
const {
  createPageWithSections,
  getEditor,
} = require('../src/admin/services/pageSections/editorService');
const { purgeInstance } = require('../src/admin/services/pageSections/instanceService');

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
  });

  const stamp = Date.now();
  const payload = {
    page: {
      page_title: `F051 Smoke ${stamp}`,
      meta_title: 'Smoke meta title',
      meta_keyword: 'smoke',
      meta_desc: 'Smoke meta description',
      featured_display: '1',
    },
    sections: [
      {
        type: 'page_banner',
        data: {
          bg_title: 'Smoke banner',
          button_title: 'Book now',
          button_link: '/book',
        },
      },
      {
        type: 'direct_access',
        admin_label: 'Intro block',
        data: {
          section_title: 'Direct access title',
          content: '<p>Smoke content</p>',
          images: [
            { img_title: 'First', access_img: 'a.jpg' },
            { img_title: 'Second', access_img: 'b.jpg' },
          ],
        },
      },
      {
        type: 'accordion',
        status: 'draft',
        data: {
          header_txt: 'FAQ',
          items: [{ accordion_title: 'Q1', accordion_text: 'A1' }],
        },
      },
    ],
  };

  const created = await createPageWithSections(pool, payload);
  console.log('create:', JSON.stringify(created));
  if (!created.ok) {
    await pool.end();
    process.exit(1);
  }

  const pageId = created.data.id;
  const editor = await getEditor(pool, pageId);
  console.log(
    'editor sections:',
    editor.data.sections.map((s) => ({
      type: s.type,
      content_id: s.content_id,
      sort_order: s.sort_order,
      status: s.status,
      label: s.admin_label,
      loaded: Boolean(s.data),
    }))
  );

  const banner = editor.data.sections.find((s) => s.type === 'page_banner');
  const direct = editor.data.sections.find((s) => s.type === 'direct_access');
  const accordion = editor.data.sections.find((s) => s.type === 'accordion');
  console.log('banner bg_title:', banner?.data?.bg_title);
  console.log('direct images:', direct?.data?.images?.length);
  console.log('accordion items:', accordion?.data?.items?.length);

  const [junction] = await pool.query(
    "SELECT section_data, section_id, sort_order FROM page_junction WHERE data_id = ? AND data_type = 'page' ORDER BY sort_order",
    [pageId]
  );
  console.log('junction rows (draft excluded):', junction);

  // Rollback check: bad section type must leave no page behind
  const badTitle = `F051 Rollback ${stamp}`;
  const bad = await createPageWithSections(pool, {
    page: { page_title: badTitle },
    sections: [{ type: 'not_a_real_section' }],
  });
  const [orphan] = await pool.query(
    'SELECT id FROM pages WHERE page_title = ?',
    [badTitle]
  );
  console.log('rollback:', bad.message, '| page rows left:', orphan.length);

  // Cleanup
  for (const section of editor.data.sections) {
    await purgeInstance(pool, pageId, section.id);
  }
  await pool.query('DELETE FROM page_junction WHERE data_id = ? AND data_type = "page"', [pageId]);
  await pool.query('DELETE FROM pages WHERE id = ?', [pageId]);
  const [left] = await pool.query('SELECT id FROM pages WHERE id = ?', [pageId]);
  console.log('cleanup done, page rows left:', left.length);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
