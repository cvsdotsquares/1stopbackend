/**
 * F-018 — Refund & delete booking (legacy booking_refund_delete_common.php).
 */
const { phpSerialize } = require('../../utils/phpSerialize');
const { formatMySQLDateToDDMMYYYY } = require('../../utils/dateFormat');
const { isEventFrozen } = require('./courseEventWizardService');
const {
  sendAdminBookingRefundEmail,
  sendAdminBookingDeleteEmail,
} = require('./adminBookingEmailService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '£0.00';
  return `£${n.toFixed(2)}`;
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function loadBookingRow(connection, bookingId) {
  const [rows] = await connection.query(
    'SELECT * FROM bookings WHERE id = ? LIMIT 1',
    [bookingId]
  );
  return rows?.[0] || null;
}

async function loadPrimaryAttendee(connection, bookingId) {
  const [rows] = await connection.query(
    `SELECT *
     FROM booking_attendees
     WHERE booking_id = ?
     ORDER BY \`primary\` DESC, id ASC
     LIMIT 1`,
    [bookingId]
  );
  const attendee = rows?.[0] || null;
  if (attendee) {
    attendee.full_name = `${trim(attendee.first_name)} ${trim(attendee.sur_name)}`.trim();
  }
  return attendee;
}

async function buildCourseInfo(connection, booking) {
  const courseInfo = {};

  const [courseRows] = await connection.query(
    'SELECT course_abb FROM courses WHERE id = ? LIMIT 1',
    [booking.course_id]
  );
  if (courseRows?.[0]) {
    courseInfo.course_abb = courseRows[0].course_abb;
  }

  const [eventRows] = await connection.query(
    `SELECT ce.location_id, l.location_name
     FROM course_events ce
     LEFT JOIN locations l ON l.id = ce.location_id
     WHERE ce.id = ?
     LIMIT 1`,
    [booking.course_event_id]
  );
  if (eventRows?.[0]?.location_name) {
    courseInfo.location = eventRows[0].location_name;
  }

  const [dateRows] = await connection.query(
    `SELECT event_date
     FROM course_event_dates
     WHERE course_event_id = ?
       AND event_date > '1900-01-01'
       AND event_date NOT IN ('1111-11-11', '0000-00-00')
     ORDER BY event_date ASC
     LIMIT 1`,
    [booking.course_event_id]
  );
  if (dateRows?.[0]) {
    courseInfo.event_date = dateRows[0].event_date;
  }

  return courseInfo;
}

async function restoreSeatCounts(connection, booking, vehicleType) {
  if (Number(booking.status) !== 1) return;

  const eventId = Number(booking.course_event_id);
  const frozen = await isEventFrozen(connection, eventId);
  const sets = ['bookings_done = GREATEST(0, bookings_done - 1)'];

  const vt = Number(vehicleType);
  if (vt === 0) {
    sets.push('manual_lock_done = GREATEST(0, manual_lock_done - 1)');
  } else if (vt === 1) {
    sets.push('automatic_lock_done = GREATEST(0, automatic_lock_done - 1)');
  }

  if (frozen) {
    await connection.query(
      `UPDATE freeze SET ${sets.join(', ')} WHERE course_event_id = ?`,
      [eventId]
    );
    return;
  }

  const [parentRows] = await connection.query(
    'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
    [eventId]
  );
  const parent = parentRows?.[0]?.parent;
  if (parent == null) return;

  await connection.query(
    `UPDATE course_events SET ${sets.join(', ')} WHERE parent = ?`,
    [parent]
  );
}

async function getDeleteMailTemplate(pool, bookingIdParam) {
  const bookingId = Number(bookingIdParam);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    const err = new Error('Invalid booking id');
    err.status = 400;
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT
       booking_attendees.booking_id,
       booking_attendees.booking_ref,
       booking_attendees.first_name,
       booking_attendees.sur_name,
       booking_attendees.email,
       bookings.total_amount,
       bookings.payment_due,
       bookings.type_of_book,
       courses.course_abb,
       courses.cancel_price,
       course_event_dates.event_date
     FROM bookings
     LEFT JOIN booking_attendees ON bookings.id = booking_attendees.booking_id
     LEFT JOIN courses ON bookings.course_id = courses.id
     LEFT JOIN course_event_dates ON bookings.course_event_id = course_event_dates.course_event_id
     WHERE bookings.id = ?
     ORDER BY booking_attendees.\`primary\` DESC, booking_attendees.id ASC
     LIMIT 1`,
    [bookingId]
  );

  const row = rows?.[0];
  if (!row) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }

  const fullName = `${trim(row.first_name)} ${trim(row.sur_name)}`.trim();
  const courseName = row.course_abb || 'Course';
  const courseDate = formatMySQLDateToDDMMYYYY(row.event_date) || 'TBC';
  const bookingRef = row.booking_ref || `1SRC${bookingId}`;
  const receivedAmount =
    Number(row.total_amount || 0) - Number(row.payment_due || 0);
  const adminFee = Number(row.cancel_price || 0);
  const refundAmount = formatCurrency(Math.max(0, receivedAmount - adminFee));
  const typeLabel = trim(row.type_of_book)
    ? trim(row.type_of_book).charAt(0).toUpperCase() +
      trim(row.type_of_book).slice(1).toLowerCase()
    : '';
  const bookingRefContent = typeLabel
    ? `${bookingRef} - ${typeLabel}`
    : bookingRef;

  const mailTemplate =
    `Dear ${fullName},\n\n` +
    `Following your recent request, your ${courseName} booked for ${courseDate} (Ref: ${bookingRefContent}) has now been cancelled.\n\n` +
    `We have also processed your refund of ${refundAmount}\n\n` +
    'Please allow 7-10 working days for any refunded amount to be received in your account, although the process usually happens a lot quicker.\n\n' +
    'If you have any further questions in the meantime, please feel free to contact us.\n\n' +
    'Regards,';

  return {
    booking_id: bookingId,
    email: row.email || '',
    subject: `Booking Cancelled - Ref: ${bookingRef}`,
    mail_template: mailTemplate,
  };
}

async function refundBooking(pool, bookingIdParam, adminId = 0) {
  const bookingId = Number(bookingIdParam);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    const err = new Error('Invalid booking id');
    err.status = 400;
    throw err;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const booking = await loadBookingRow(connection, bookingId);
    if (!booking) {
      const err = new Error('Booking not found to refund');
      err.status = 404;
      throw err;
    }

    if (Number(booking.refundable) !== 1) {
      const err = new Error('This booking is not eligible for refund');
      err.status = 400;
      throw err;
    }

    const [updateResult] = await connection.query(
      'UPDATE bookings SET refundable = 2, status = 2, modified = NOW() WHERE id = ?',
      [bookingId]
    );

    if (!updateResult.affectedRows) {
      const err = new Error('Error in refund for bookings');
      err.status = 500;
      throw err;
    }

    await connection.commit();

    const emailResult = await sendAdminBookingRefundEmail(pool, bookingId, {
      adminId,
    });

    return {
      booking_id: bookingId,
      course_event_id: booking.course_event_id,
      message: 'Refunded successfully',
      email_sent: Boolean(emailResult?.sent),
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function deleteBooking(pool, bookingIdParam, adminId = 0, options = {}) {
  const bookingId = Number(bookingIdParam);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    const err = new Error('Invalid booking id');
    err.status = 400;
    throw err;
  }

  const deleteType = trim(options.delete_type || options.deleteType);
  const sendEmail =
    deleteType === 'send_mail_delete' &&
    trim(options.before_del_email) &&
    trim(options.before_del_subject) &&
    trim(options.before_del_message);

  const connection = await pool.getConnection();
  let courseEventId;
  let bookingRef;
  let emailPayload = null;

  try {
    await connection.beginTransaction();

    const booking = await loadBookingRow(connection, bookingId);
    if (!booking) {
      const err = new Error('Booking not found to delete');
      err.status = 404;
      throw err;
    }

    if (
      Number(booking.status) !== 1 ||
      Number(booking.refundable) !== 0
    ) {
      const err = new Error('This booking cannot be deleted');
      err.status = 400;
      throw err;
    }

    courseEventId = booking.course_event_id;
    const attendee = await loadPrimaryAttendee(connection, bookingId);
    if (!attendee) {
      const err = new Error('Booking attendee not found');
      err.status = 404;
      throw err;
    }

    bookingRef = attendee.booking_ref || `1SRC${bookingId}`;
    const courseInfo = await buildCourseInfo(connection, booking);

    await restoreSeatCounts(connection, booking, attendee.vehicle_type);

    if (sendEmail) {
      emailPayload = {
        email: trim(options.before_del_email),
        subject: trim(options.before_del_subject),
        content: trim(options.before_del_message),
        bookingRef,
      };
    }

    const [deleteResult] = await connection.query(
      'DELETE FROM bookings WHERE id = ?',
      [bookingId]
    );
    if (!deleteResult.affectedRows) {
      const err = new Error('Error in deleting bookings');
      err.status = 500;
      throw err;
    }

    await connection.query('DELETE FROM booking_attendees WHERE booking_id = ?', [
      bookingId,
    ]);
    await connection.query(
      'DELETE FROM booking_attendees_dropdown WHERE booking_id = ?',
      [bookingId]
    );
    await connection.query(
      'UPDATE booking_payments SET isDelete = 1 WHERE booking_id = ?',
      [bookingId]
    );

    const now = formatTimestamp();
    await connection.query(
      `INSERT INTO booking_update_history
         (booking_id, updated_by_admin_id, type, status, created, modified)
       VALUES (?, ?, 'deleted', 'Booking deleted', ?, ?)`,
      [bookingId, adminId || 0, now, now]
    );

    const snapshot = phpSerialize({
      booking,
      attendee,
      course_info: courseInfo,
      deleted_via: 'admin-api',
    });

    await connection.query(
      `INSERT INTO deleted_bookings (booking_id, booking_ref, booking_data)
       VALUES (?, ?, ?)`,
      [bookingId, bookingRef, snapshot]
    );

    await connection.commit();

    let emailSent = false;
    if (emailPayload) {
      const emailResult = await sendAdminBookingDeleteEmail(pool, bookingId, emailPayload);
      emailSent = Boolean(emailResult?.sent);
    }

    return {
      booking_id: bookingId,
      course_event_id: courseEventId,
      message:
        'Booking deleted successfully and increases space availablity',
      email_sent: emailSent,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  getDeleteMailTemplate,
  refundBooking,
  deleteBooking,
};
