const mysql = require('mysql2/promise');

(async () => {
  const pool = await mysql.createPool({
    host: '172.236.21.167',
    port: 3306,
    user: '1stop',
    password: 'Gbgz&En4Wg&HmFJTFf',
    database: '1stop',
  });

  const [rows] = await pool.query(
    `SELECT data_id, section_data, sort_order
     FROM page_junction
     WHERE LOWER(section_data) LIKE ?
     ORDER BY data_id DESC, section_data ASC`,
    ['%cbt%']
  );

  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
