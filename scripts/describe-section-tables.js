require('../src/loadEnv');
const mysql = require('mysql2/promise');

const TABLES = [
  'pageSliders',
  'pageSliderImg',
  'sliderBoxData',
  'direct_access',
  'direct_access_image',
  'our_services',
  'service_images',
  'cbt_across_london',
  'cbt_test_london',
  'expert_training_slider',
  'expert_training_slider_images',
  'why_1stop',
  'why_1stop_images',
  'our_exceptional',
  'pages_banner',
  'dynamic_content_sections',
  'dynamic_content_items',
  'tab_section',
  'tabs',
  'info_card_section',
  'info_card_data',
  'price_card_sections',
  'price_card_data',
  'service_areas_section',
  'service_areas_data',
  'accordion_section',
  'accordion_sec_data',
  'content_cards_section',
  'content_cards_items',
  'process_steps',
  'process_step_content',
  'cms_sidebar',
];

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  for (const table of TABLES) {
    try {
      const [cols] = await pool.query(`DESCRIBE \`${table}\``);
      console.log(`\n=== ${table} ===`);
      cols.forEach((c) => console.log(`  ${c.Field}\t${c.Type}\t${c.Null}\t${c.Key}`));
    } catch (err) {
      console.log(`\n=== ${table} === ERROR: ${err.message}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
