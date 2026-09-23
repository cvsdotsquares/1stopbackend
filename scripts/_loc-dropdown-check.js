require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');

(async () => {
  const p = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [legacy] = await p.query(
    "SELECT id, loc_abb FROM locations WHERE show_in_vehicle_schedule = 1 AND status = '1' ORDER BY loc_abb ASC"
  );
  const [activeOnly] = await p.query(
    'SELECT id, loc_abb, status, show_in_vehicle_schedule FROM locations WHERE status = 1 ORDER BY loc_abb ASC'
  );
  const [schedFlag] = await p.query(
    'SELECT id, loc_abb, status, show_in_vehicle_schedule FROM locations WHERE show_in_vehicle_schedule = 1 ORDER BY loc_abb ASC'
  );
  console.log('legacy dropdown SQL:', legacy.map((r) => `${r.id}:${r.loc_abb}`));
  console.log('status=1 (no sched flag):', activeOnly.length, activeOnly.map((r) => r.loc_abb));
  console.log('show_in_vehicle_schedule=1 (any status):', schedFlag.map((r) => `${r.loc_abb}(st=${r.status})`));
  await p.end();
})();
