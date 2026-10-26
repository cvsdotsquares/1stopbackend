// src/utils/archiveBooking.js
//
// Shared "remove an unpaid booking" path, extracted from the cleanup cron so
// the Stripe webhook can remove a booking on exactly the same terms (archive
// snapshot + audit row + seat release) instead of duplicating the SQL.
//
// Mirrors the legacy PHP delete flow in
// 1stop-php/admin/booking_refund_delete_common.php.
//
// The caller owns the transaction.
const { phpSerialize } = require('./phpSerialize');
const { applyGroupSpaceDelta } = require('./courseEventGroup');

/**
 * Release the seat, snapshot the booking into `deleted_bookings`, write an
 * audit row, then hard-delete the booking and its attendees.
 *
 * @param {import('mysql2/promise').PoolConnection} connection in an open transaction
 * @param {object} booking full `bookings` row
 * @param {{ reason: string, cancelledVia: string, at: string, timeoutMinutes?: number|string }} options
 */
async function archiveAndDeleteBooking(connection, booking, { reason, cancelledVia, at, timeoutMinutes }) {
  if (booking.course_event_id && booking.spaces) {
    await applyGroupSpaceDelta(connection, booking.course_event_id, {
      lockDelta: -booking.spaces,
    });
  }

  const [primaryAttendeeRows] = await connection.query(
    `SELECT *
     FROM booking_attendees
     WHERE booking_id = ?
     ORDER BY \`primary\` DESC, id ASC
     LIMIT 1`,
    [booking.id]
  );
  const primaryAttendee = primaryAttendeeRows[0] || {};
  primaryAttendee.full_name = `${(primaryAttendee.first_name || '').trim()} ${(primaryAttendee.sur_name || '').trim()}`.trim();

  const [courseRows] = await connection.query(
    `SELECT course_abb FROM courses WHERE id = ? LIMIT 1`,
    [booking.course_id]
  );
  const [eventLocationRows] = await connection.query(
    `SELECT ce.location_id, l.location_name
     FROM course_events ce
     LEFT JOIN locations l ON ce.location_id = l.id
     WHERE ce.id = ?
     LIMIT 1`,
    [booking.course_event_id]
  );
  const [firstDateRows] = await connection.query(
    `SELECT event_date
     FROM course_event_dates
     WHERE course_event_id = ?
       AND event_date > '1900-01-01'
       AND event_date NOT IN ('1111-11-11', '0000-00-00')
     ORDER BY event_date ASC
     LIMIT 1`,
    [booking.course_event_id]
  );

  const courseInfo = {};
  if (courseRows[0]) courseInfo.course_abb = courseRows[0].course_abb;
  if (eventLocationRows[0]) courseInfo.location = eventLocationRows[0].location_name;
  if (firstDateRows[0]) courseInfo.event_date = firstDateRows[0].event_date;

  await connection.query(
    `UPDATE booking_payments SET isDelete = 1 WHERE booking_id = ?`,
    [booking.id]
  );

  const bookingRefValue = primaryAttendee.booking_ref || `1SRC${booking.id}`;
  const snapshot = phpSerialize({
    booking,
    attendee: primaryAttendee,
    course_info: courseInfo,
    cancelled_via: cancelledVia,
    ...(timeoutMinutes === undefined ? {} : { timeout_minutes: Number(timeoutMinutes) }),
  });

  await connection.query(
    `INSERT INTO deleted_bookings (booking_id, booking_ref, booking_data)
     VALUES (?, ?, ?)`,
    [booking.id, bookingRefValue, snapshot]
  );

  await connection.query(
    `INSERT INTO booking_update_history
       (booking_id, updated_by_admin_id, type, status, created, modified)
     VALUES (?, 0, 'deleted', ?, ?, ?)`,
    [booking.id, reason, at, at]
  );

  await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking.id]);
  await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking.id]);
  await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking.id]);
}

module.exports = { archiveAndDeleteBooking };
