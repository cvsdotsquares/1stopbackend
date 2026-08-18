require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await c.query(
    `ALTER TABLE courses
       MODIFY COLUMN default_price_type VARCHAR(10) NULL DEFAULT NULL`
  );
  console.log('default_price_type is now NULLable');

  const [result] = await c.query(
    `UPDATE courses
     SET default_price_type = NULL
     WHERE COALESCE(default_school_one_off_price, 0) = 0
       AND COALESCE(default_school_deposit_price, 0) = 0
       AND COALESCE(default_school_total_price, 0) = 0
       AND COALESCE(default_own_one_off_price, 0) = 0
       AND COALESCE(default_own_deposit_price, 0) = 0
       AND COALESCE(default_own_total_price, 0) = 0`
  );
  console.log(`reset default_price_type to NULL on ${result.affectedRows} course(s)`);

  await c.end();
  console.log('done');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
