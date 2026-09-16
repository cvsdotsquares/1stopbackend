require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');

const bookingColumns = [
  {
    name: 'on_hold',
    sql: "ADD COLUMN on_hold TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=held: capacity released, skip auto-comms' AFTER refundable",
  },
  {
    name: 'on_hold_at',
    sql: 'ADD COLUMN on_hold_at DATETIME NULL DEFAULT NULL AFTER on_hold',
  },
  {
    name: 'on_hold_by_admin_id',
    sql: 'ADD COLUMN on_hold_by_admin_id INT NOT NULL DEFAULT 0 AFTER on_hold_at',
  },
  {
    name: 'held_course_event_id',
    sql: "ADD COLUMN held_course_event_id INT NULL DEFAULT NULL COMMENT 'course_event_id at the time of hold' AFTER on_hold_by_admin_id",
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

  const [existingRows] = await c.query('SHOW COLUMNS FROM bookings');
  const existing = new Set((existingRows || []).map((row) => row.Field));

  for (const column of bookingColumns) {
    if (existing.has(column.name)) {
      console.log(`skip bookings.${column.name} (already exists)`);
      continue;
    }
    await c.query(`ALTER TABLE bookings ${column.sql}`);
    console.log(`added bookings.${column.name}`);
  }

  const [tables] = await c.query("SHOW TABLES LIKE 'booking_hold_history'");
  if (tables?.length) {
    console.log('skip booking_hold_history (already exists)');
  } else {
    await c.query(`
      CREATE TABLE booking_hold_history (
        id INT NOT NULL AUTO_INCREMENT,
        booking_id INT NOT NULL,
        action VARCHAR(20) NOT NULL,
        from_course_event_id INT NULL DEFAULT NULL,
        to_course_event_id INT NULL DEFAULT NULL,
        notes VARCHAR(255) NOT NULL DEFAULT '',
        updated_by_admin_id INT NOT NULL DEFAULT 0,
        created DATETIME NOT NULL,
        PRIMARY KEY (id),
        KEY booking_id (booking_id),
        KEY action (action)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3
    `);
    console.log('created booking_hold_history');
  }

  await c.end();
  console.log('done');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
