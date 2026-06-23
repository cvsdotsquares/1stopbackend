const { LOCK_EXPIRE_TIME_MINUTES } = require('../constants');

/**
 * Port of Booking::removeExpirelocks() from booking.class.php
 */
async function removeExpirelocks(pool, session) {
  if (session && session.preFillData) {
    delete session.preFillData;
  }

  const cDate = new Date()
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  const [locks] = await pool.query(
    `SELECT * FROM lock_bookings
     WHERE ? >= (created + INTERVAL ? MINUTE)`,
    [cDate, LOCK_EXPIRE_TIME_MINUTES]
  );

  if (!locks || locks.length === 0) {
    return;
  }

  for (const lock of locks) {
    const [deleteResult] = await pool.query(
      'DELETE FROM lock_bookings WHERE id = ?',
      [lock.id]
    );

    if (!deleteResult || deleteResult.affectedRows === 0) {
      continue;
    }

    const [eventsData] = await pool.query(
      'SELECT * FROM course_events WHERE parent = ?',
      [lock.parent]
    );

    for (const edata of eventsData) {
      const svM = edata.manual_lock_done - lock.manual_lock;
      const svA = edata.automatic_lock_done - lock.automatic_lock;

      await pool.query(
        'UPDATE course_events SET manual_lock_done = ?, automatic_lock_done = ? WHERE id = ?',
        [svM, svA, edata.id]
      );
      await pool.query(
        'UPDATE course_events SET current_locks = current_locks - ? WHERE id = ? AND current_locks > 0',
        [lock.space_required, edata.id]
      );
    }
  }
}

module.exports = { removeExpirelocks };
