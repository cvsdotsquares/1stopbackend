const { LOCK_EXPIRE_TIME_MINUTES } = require('../constants');

const GUEST_LOCK_EXPIRE_MINUTES = 10;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function parseUnixTimestamp(value) {
  if (!value) return 0;
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  const parsed = Date.parse(String(value).replace(' ', 'T'));
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.floor(parsed / 1000);
}

function usesGuestLockExpiry(userNames, lockedBy, userId) {
  if (userNames === 'Guest' || userNames === 'online') {
    return true;
  }

  const numericUserId = Number(userId);
  return (
    lockedBy === 'online' &&
    (userId == null ||
      userId === '' ||
      numericUserId === 0 ||
      Number.isNaN(numericUserId))
  );
}

function computeExpiresAt(bookingDate, userNames, lockedBy, userId) {
  const lockTime = parseUnixTimestamp(bookingDate);
  const minutes = usesGuestLockExpiry(userNames, lockedBy, userId)
    ? GUEST_LOCK_EXPIRE_MINUTES
    : LOCK_EXPIRE_TIME_MINUTES;
  return lockTime + minutes * 60;
}

async function listInProgressBookings(pool) {
  const [rows] = await pool.query(
    `SELECT
      lb.id AS lock_id,
      ce.id AS course_event_id,
      c.course_name,
      l.location_name,
      lb.created AS booking_date,
      lb.locked_by,
      lb.user_id,
      lb.space_required,
      lb.ip_address,
      lb.payment_page_stauts,
      (
        SELECT ced.event_date
        FROM course_event_dates ced
        WHERE ced.course_event_id = ce.id
        LIMIT 1
      ) AS evDate,
      (
        SELECT ced.event_start_time
        FROM course_event_dates ced
        WHERE ced.course_event_id = ce.id
        LIMIT 1
      ) AS evStart,
      (
        SELECT ced.event_end_time
        FROM course_event_dates ced
        WHERE ced.course_event_id = ce.id
        LIMIT 1
      ) AS evEnd,
      CASE
        WHEN lb.user_id > 0 AND lb.locked_by = 'terminal' THEN CONCAT('Admin (', a.admin_fristname, ' ', a.admin_lastname, ')')
        WHEN lb.user_id > 0 AND lb.locked_by = 'online' THEN CONCAT(u.first_name, ' ', u.sur_name)
        WHEN lb.user_id = -1 AND lb.locked_by = 'terminal' THEN 'Admin'
        WHEN lb.user_id = -1 AND lb.locked_by = 'ride2' THEN 'RideTo'
        WHEN (lb.user_id IS NULL OR lb.user_id = 0 OR lb.user_id = '') AND lb.locked_by = 'online' THEN 'Guest'
        ELSE NULL
      END AS user_names
    FROM course_events ce
    JOIN lock_bookings lb ON lb.event_id = ce.id
    LEFT JOIN users u ON lb.user_id = u.id AND lb.locked_by = 'online'
    LEFT JOIN admin a ON lb.user_id = a.admin_id AND lb.locked_by = 'terminal'
    LEFT JOIN courses c ON c.id = ce.course_id
    LEFT JOIN locations l ON l.id = ce.location_id
    WHERE ce.current_locks > 0
    ORDER BY ce.id DESC, lb.id DESC`
  );

  return (rows || []).map((row) => {
    const userNames = trim(row.user_names) || null;
    const paymentStatus = Number(row.payment_page_stauts) || 0;

    return {
      lock_id: Number(row.lock_id),
      course_event_id: Number(row.course_event_id),
      course_name: trim(row.course_name),
      location_name: trim(row.location_name),
      evDate: row.evDate ? String(row.evDate).slice(0, 10) : '',
      evStart: trim(row.evStart),
      evEnd: trim(row.evEnd),
      user_names: userNames,
      payment_stage_reached: paymentStatus === 0 ? 'No' : 'Yes',
      space_required: Number(row.space_required) || 0,
      ip_address: trim(row.ip_address),
      booking_date: row.booking_date,
      expires_at: computeExpiresAt(
        row.booking_date,
        userNames,
        row.locked_by,
        row.user_id
      ),
    };
  });
}

module.exports = {
  listInProgressBookings,
  computeExpiresAt,
  usesGuestLockExpiry,
};
