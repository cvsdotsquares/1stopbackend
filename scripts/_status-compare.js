require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');

(async () => {
  const p = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [cols] = await p.query('SHOW COLUMNS FROM locations LIKE "status"');
  console.log('status column:', cols[0]);

  const [sStr] = await p.query(
    "SELECT id, loc_abb, status, show_in_vehicle_schedule FROM locations WHERE show_in_vehicle_schedule = 1 AND status = '1' ORDER BY loc_abb"
  );
  const [sNum] = await p.query(
    'SELECT id, loc_abb, status, show_in_vehicle_schedule FROM locations WHERE show_in_vehicle_schedule = 1 AND status = 1 ORDER BY loc_abb'
  );

  const strIds = new Set(sStr.map((r) => r.id));
  const numIds = new Set(sNum.map((r) => r.id));
  const onlyStr = sStr.filter((r) => !numIds.has(r.id));
  const onlyNum = sNum.filter((r) => !strIds.has(r.id));

  console.log('count status=\'1\':', sStr.length);
  console.log('count status=1:', sNum.length);
  console.log('only in string query:', onlyStr.map((r) => ({ id: r.id, abb: r.loc_abb, status: r.status })));
  console.log('only in numeric query:', onlyNum.map((r) => ({ id: r.id, abb: r.loc_abb, status: r.status })));

  const [barnet] = await p.query("SELECT id, loc_abb, status FROM locations WHERE loc_abb='Barnet'");
  const [ds] = await p.query("SELECT id, loc_abb, status FROM locations WHERE loc_abb='DS'");
  console.log('Barnet row:', barnet[0]);
  console.log('DS row:', ds[0]);

  await p.end();
})();
