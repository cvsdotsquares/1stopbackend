/**
 * F-020 — In-progress bookings list.
 * Replaces legacy `current_booking_details.php` (direct DB query, no PHP HTTP calls).
 */
const { LOCK_EXPIRE_TIME_MINUTES } = require('../constants');
const { removeExpirelocks } = require('./bookingService');

const GUEST_LOCK_EXPIRE_MINUTES = 10;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatEventDateLabel(evDate) {
  if (!evDate || evDate === '0000-00-00') return 'TBC';
  const d = new Date(`${String(evDate).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(evDate);
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function computeExpiresAtUnix(created, userLabel) {
  const lockMs = new Date(created).getTime();
  if (Number.isNaN(lockMs)) return 0;
  const minutes =
    userLabel === 'Guest' ? GUEST_LOCK_EXPIRE_MINUTES : LOCK_EXPIRE_TIME_MINUTES;
  return Math.floor(lockMs / 1000) + minutes * 60;
}

async function getInProgressBookings(pool, session) {
  await removeExpirelocks(pool, session);

  const [rows] = await pool.query(
    `SELECT
      lb.id AS lock_id,
      ce.id AS course_event_id,
      lb.created AS booking_date,
      c.course_name AS booking_course,
      l.location_name AS booking_location,
      (SELECT ced.event_date FROM course_event_dates ced WHERE ced.course_event_id = ce.id LIMIT 1) AS evDate,
      (SELECT ced.event_start_time FROM course_event_dates ced WHERE ced.course_event_id = ce.id LIMIT 1) AS evStart,
      (SELECT ced.event_end_time FROM course_event_dates ced WHERE ced.course_event_id = ce.id LIMIT 1) AS evEnd,
      lb.locked_by,
      lb.user_id,
      lb.space_required,
      lb.ip_address,
      lb.payment_page_stauts AS paymentStatus,
      CASE
        WHEN lb.user_id > 0 AND lb.locked_by = 'terminal' THEN CONCAT('Admin (', a.admin_fristname, ' ', a.admin_lastname, ')')
        WHEN lb.user_id > 0 AND lb.locked_by = 'online' THEN CONCAT(u.first_name, ' ', u.sur_name)
        WHEN lb.user_id = -1 AND lb.locked_by = 'terminal' THEN 'Admin'
        WHEN lb.user_id = -1 AND lb.locked_by = 'ride2' THEN 'RideTo'
        WHEN (lb.user_id IS NULL OR lb.user_id = 0 OR lb.user_id = '') AND lb.locked_by = 'online' THEN 'Guest'
        ELSE NULL
      END AS user_names
    FROM course_events ce
    JOIN lock_bookings lb ON lb.event_id = ce.id AND lb.delete_process = 0
    LEFT JOIN users u ON lb.user_id = u.id AND lb.locked_by = 'online'
    LEFT JOIN admin a ON lb.user_id = a.admin_id AND lb.locked_by = 'terminal'
    LEFT JOIN courses c ON c.id = ce.course_id
    LEFT JOIN locations l ON l.id = ce.location_id
    WHERE ce.current_locks > 0
    ORDER BY ce.id DESC, lb.id DESC`
  );

  const bookings = (rows || []).map((row) => {
    const userLabel = row.user_names ? String(row.user_names).trim() : '';
    const evStart = row.evStart ? String(row.evStart).trim() : '';
    const evEnd = row.evEnd ? String(row.evEnd).trim() : '';
    const timeRange =
      evStart && evEnd ? `${evStart} - ${evEnd}` : evStart || evEnd || '';

    return {
      lock_id: Number(row.lock_id),
      course_event_id: Number(row.course_event_id),
      event_date_label: formatEventDateLabel(row.evDate),
      event_time_label: timeRange,
      course_name: row.booking_course || '',
      location_name: row.booking_location || '',
      user_label: userLabel,
      payment_page_reached: Number(row.paymentStatus) === 1,
      space_required: Number(row.space_required) || 0,
      ip_address: row.ip_address || '',
      created: row.booking_date,
      expires_at_unix: computeExpiresAtUnix(row.booking_date, userLabel),
    };
  });

  return { bookings };
}

module.exports = { getInProgressBookings };
