const {
  LOCK_EXPIRE_TIME_MINUTES,
  STRIPE_PAYMENT_LINK_LOCKED_BY,
} = require('../constants');

/**
 * Port of Booking::removeExpirelocks() from booking.class.php
 * Uses MySQL NOW() (server local time) like legacy date('Y-m-d H:i:s').
 */
async function removeExpirelocks(pool, session) {
  if (session?.preFillData) {
    delete session.preFillData;
  }

  const activeLockId = Number(session?.adminBooking?.lock_session?.id) || 0;
  const params = [LOCK_EXPIRE_TIME_MINUTES];
  let activeClause = '';
  if (activeLockId > 0) {
    activeClause = ' AND id != ?';
    params.push(activeLockId);
  }
  params.push(STRIPE_PAYMENT_LINK_LOCKED_BY);

  const [locks] = await pool.query(
    `SELECT * FROM lock_bookings
     WHERE NOW() >= (created + INTERVAL ? MINUTE)${activeClause}
       AND locked_by != ?
       AND id NOT IN (
         SELECT DISTINCT lockid FROM bookings
         WHERE status = 0 AND lockid > 0
       )`,
    params
  );

  if (!locks?.length) {
    return;
  }

  for (const lock of locks) {
    const [deleteResult] = await pool.query(
      'DELETE FROM lock_bookings WHERE id = ?',
      [lock.id]
    );

    if (!deleteResult?.affectedRows) {
      continue;
    }

    const [eventsData] = await pool.query(
      'SELECT * FROM course_events WHERE parent = ?',
      [lock.parent]
    );

    for (const edata of eventsData || []) {
      const svM =
        Number(edata.manual_lock_done || 0) - Number(lock.manual_lock || 0);
      const svA =
        Number(edata.automatic_lock_done || 0) -
        Number(lock.automatic_lock || 0);

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
