require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const columns = [
  {
    name: 'default_price_type',
    sql: 'ADD COLUMN default_price_type VARCHAR(10) NULL DEFAULT NULL AFTER default_end_time',
  },
  {
    name: 'default_school_one_off_price',
    sql: 'ADD COLUMN default_school_one_off_price DOUBLE NOT NULL DEFAULT 0 AFTER default_price_type',
  },
  {
    name: 'default_school_deposit_price',
    sql: 'ADD COLUMN default_school_deposit_price DOUBLE NOT NULL DEFAULT 0 AFTER default_school_one_off_price',
  },
  {
    name: 'default_school_total_price',
    sql: 'ADD COLUMN default_school_total_price DOUBLE NOT NULL DEFAULT 0 AFTER default_school_deposit_price',
  },
  {
    name: 'default_own_one_off_price',
    sql: 'ADD COLUMN default_own_one_off_price DOUBLE NOT NULL DEFAULT 0 AFTER default_school_total_price',
  },
  {
    name: 'default_own_deposit_price',
    sql: 'ADD COLUMN default_own_deposit_price DOUBLE NOT NULL DEFAULT 0 AFTER default_own_one_off_price',
  },
  {
    name: 'default_own_total_price',
    sql: 'ADD COLUMN default_own_total_price DOUBLE NOT NULL DEFAULT 0 AFTER default_own_deposit_price',
  },
];

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  const [existingRows] = await c.query('SHOW COLUMNS FROM courses');
  const existing = new Set((existingRows || []).map((row) => row.Field));

  for (const column of columns) {
    if (existing.has(column.name)) {
      console.log(`skip ${column.name} (already exists)`);
      continue;
    }
    await c.query(`ALTER TABLE courses ${column.sql}`);
    console.log(`added ${column.name}`);
  }

  await c.end();
  console.log('done');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
