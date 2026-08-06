/**
 * Normalize page_menus.sort_order to a clean 1..n sequence per (menu_group, parent_id).
 *
 * Legacy sort_order values were never used by the public /api/helper/menu-structure
 * endpoint, which ordered by id. Now that both admin and public order by
 * (sort_order, id), those stale values would silently reshuffle the live menu.
 * Seeding sort_order from the current id order keeps the rendered menu byte for
 * byte identical while making later drag-and-drop changes meaningful.
 *
 * Usage:
 *   node scripts/normalize-page-menu-sort.js            # dry run, prints the plan
 *   node scripts/normalize-page-menu-sort.js --apply    # writes the changes
 */
require('../src/loadEnv');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rows] = await pool.query(
    `SELECT id, page_title, menu_group, parent_id, sort_order
       FROM page_menus
      ORDER BY id ASC`
  );

  const counters = new Map();
  const changes = [];

  for (const row of rows) {
    const key = `${row.menu_group || ''}::${row.parent_id || 0}`;
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    if (Number(row.sort_order) !== next) {
      changes.push({
        id: row.id,
        page_title: row.page_title,
        menu_group: row.menu_group || 'No Group',
        parent_id: row.parent_id || null,
        from: Number(row.sort_order),
        to: next,
      });
    }
  }

  console.log(`Scanned ${rows.length} menu items, ${changes.length} need a new sort_order.`);
  for (const change of changes) {
    console.log(
      `  #${change.id} [${change.menu_group}] parent=${change.parent_id || '-'} ` +
        `${change.from} -> ${change.to}  ${change.page_title}`
    );
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these values.');
    await pool.end();
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const change of changes) {
      await connection.query('UPDATE page_menus SET sort_order = ? WHERE id = ?', [
        change.to,
        change.id,
      ]);
    }
    await connection.commit();
    console.log(`\nApplied ${changes.length} updates.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
