/**
 * Booking Hold Management.
 * Confirmed bookings stay status=1; on_hold=1 releases capacity and skips auto-comms.
 */
const { isEventFrozen } = require('./courseEventWizardService');
const { getCurrentMysqlDateTime } = require('../../utils/dateFormat');
const { sendAdminBookingConfirmationEmail } = require('./adminBookingEmailService');

const TBC_DATE = '0000-00-00';
const INVALID_EVENT_DATES = new Set([TBC_DATE, '1111-11-11']);

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isOnHold(booking) {
  return Number(booking?.on_hold) === 1;
}

function isValidComparableEventDate(value) {
  const key = toMysqlDateKey(value);
  return Boolean(key && key > '1900-01-01' && !INVALID_EVENT_DATES.has(key));
}

function getTodayDateKey() {
  return toMysqlDateKey(new Date());
}

function isEventDatePassed(latestEventDate, todayKey = getTodayDateKey()) {
  if (!isValidComparableEventDate(latestEventDate)) return false;
  return toMysqlDateKey(latestEventDate) < todayKey;
}

function getLatestEventDateFromRows(dateRows) {
  let latest = '';
  for (const row of dateRows || []) {
    const key = toMysqlDateKey(row?.event_date);
    if (!isValidComparableEventDate(key)) continue;
    if (!latest || key > latest) latest = key;
  }
  return latest;
}

async function loadLatestEventDate(connection, courseEventId) {
  const [rows] = await connection.query(
    `SELECT MAX(ced.event_date) AS latest_event_date
     FROM course_event_dates ced
     WHERE ced.course_event_id = ?
       AND ced.event_date > '1900-01-01'
       AND ced.event_date NOT IN ('1111-11-11', '0000-00-00')`,
    [courseEventId]
  );
  return toMysqlDateKey(rows?.[0]?.latest_event_date);
}

function canHoldBooking(booking, { eventDatePassed = false } = {}) {
  return (
    Number(booking?.status) === 1 &&
    Number(booking?.refundable) === 0 &&
    !isOnHold(booking) &&
    !eventDatePassed
  );
}

function canReinstateBooking(booking) {
  return Number(booking?.status) === 1 && isOnHold(booking);
}

function toMysqlDateKey(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const raw = trim(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return '';
}

function formatLongDate(value) {
  if (!value || value === TBC_DATE || value === 'TBC') return 'TBC';
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  const weekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${weekdays[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function seatSetClauses(vehicleType, direction) {
  const op = direction === 'consume' ? '+' : '-';
  const sets = [`bookings_done = GREATEST(0, bookings_done ${op} 1)`];
  const vt = Number(vehicleType);
  if (vt === 0) {
    sets.push(`manual_lock_done = GREATEST(0, manual_lock_done ${op} 1)`);
  } else if (vt === 1) {
    sets.push(`automatic_lock_done = GREATEST(0, automatic_lock_done ${op} 1)`);
  }
  return sets;
}

async function applySeatChange(connection, eventId, vehicleType, direction) {
  const frozen = await isEventFrozen(connection, eventId);
  const sets = seatSetClauses(vehicleType, direction);

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

async function loadBooking(connection, bookingId) {
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
  return rows?.[0] || null;
}

async function writeAudit(connection, {
  bookingId,
  adminId,
  type,
  status,
  action,
  fromEventId,
  toEventId,
  notes,
}) {
  const now = getCurrentMysqlDateTime();
  await connection.query(
    `INSERT INTO booking_update_history
      (booking_id, updated_by_admin_id, type, status, created, modified)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [bookingId, adminId || 0, type, status, now, now]
  );
  await connection.query(
    `INSERT INTO booking_hold_history
      (booking_id, action, from_course_event_id, to_course_event_id, notes,
       updated_by_admin_id, created)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      bookingId,
      action,
      fromEventId || null,
      toEventId || null,
      trim(notes).slice(0, 255),
      adminId || 0,
      now,
    ]
  );
}

async function loadEventCapacity(connection, eventId) {
  const [rows] = await connection.query(
    `SELECT id, course_id, booking_limit, bookings_done, current_locks,
            vehicle_type_manual, vehicle_type_automatic, vehicle_type_own, status
     FROM course_events
     WHERE id = ?
     LIMIT 1`,
    [eventId]
  );
  return rows?.[0] || null;
}

function eventHasSpace(event, spaces = 1) {
  const available =
    (Number(event.booking_limit) || 0) -
    (Number(event.bookings_done) || 0) -
    (Number(event.current_locks) || 0);
  return available >= spaces;
}

function spacesRemaining(row) {
  return Math.max(
    0,
    (Number(row.booking_limit) || 0) -
      (Number(row.bookings_done) || 0) -
      (Number(row.current_locks) || 0)
  );
}

function buildEventOption(row, { isCurrent = false } = {}) {
  const eventDate = toMysqlDateKey(row.event_date);
  const start = row.event_start_time
    ? String(row.event_start_time).slice(0, 5)
    : '';
  const end = row.event_end_time ? String(row.event_end_time).slice(0, 5) : '';
  const locationName = row.location_name || '';
  const suffix = isCurrent ? ' (original date)' : '';
  return {
    course_event_id: Number(row.course_event_id || row.id),
    course_id: Number(row.course_id),
    course_name: row.course_name || '',
    location_name: locationName,
    event_date: eventDate,
    timings: `${start} - ${end}`.trim(),
    is_current: isCurrent,
    spaces_available: spacesRemaining(row),
    label: `${formatLongDate(eventDate)} — ${locationName} — ${start} - ${end}${suffix}`.trim(),
  };
}

async function holdBooking(pool, bookingIdParam, adminId = 0, options = {}) {
  const bookingId = Number(bookingIdParam);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    throw httpError('Invalid booking id');
  }

  const notes = trim(options.notes);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const booking = await loadBooking(connection, bookingId);
    if (!booking) throw httpError('Booking not found', 404);

    const latestEventDate = await loadLatestEventDate(
      connection,
      Number(booking.course_event_id)
    );
    const eventDatePassed = isEventDatePassed(latestEventDate);
    if (eventDatePassed) {
      throw httpError(
        'Cannot place a booking on hold after the course date has passed'
      );
    }
    if (!canHoldBooking(booking, { eventDatePassed })) {
      throw httpError('This booking cannot be placed on hold');
    }

    const attendee = await loadPrimaryAttendee(connection, bookingId);
    if (!attendee) throw httpError('Booking attendee not found', 404);

    await applySeatChange(
      connection,
      Number(booking.course_event_id),
      attendee.vehicle_type,
      'release'
    );

    const now = getCurrentMysqlDateTime();
    await connection.query(
      `UPDATE bookings
       SET on_hold = 1,
           on_hold_at = ?,
           on_hold_by_admin_id = ?,
           held_course_event_id = ?,
           modified = ?
       WHERE id = ?`,
      [now, adminId || 0, booking.course_event_id, now, bookingId]
    );

    const noteSuffix = notes ? ` — ${notes}` : '';
    await writeAudit(connection, {
      bookingId,
      adminId,
      type: 'held',
      status: `Booking placed on hold; course capacity released${noteSuffix}`,
      action: 'held',
      fromEventId: booking.course_event_id,
      toEventId: booking.course_event_id,
      notes,
    });

    await connection.commit();
    return {
      booking_id: bookingId,
      course_event_id: Number(booking.course_event_id),
      on_hold: 1,
      message: 'Booking placed on hold. Course capacity has been released.',
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function loadEventOption(pool, eventId) {
  const [rows] = await pool.query(
    `SELECT
       ce.id AS course_event_id,
       ce.course_id,
       ce.booking_limit,
       ce.bookings_done,
       ce.current_locks,
       c.course_name,
       l.location_name,
       DATE_FORMAT(MIN(ced.event_date), '%Y-%m-%d') AS event_date,
       MIN(ced.event_start_time) AS event_start_time,
       MIN(ced.event_end_time) AS event_end_time
     FROM course_events ce
     JOIN courses c ON c.id = ce.course_id
     LEFT JOIN locations l ON l.id = ce.location_id
     LEFT JOIN course_event_dates ced
       ON ced.course_event_id = ce.id
      AND ced.event_date > '1900-01-01'
      AND ced.event_date NOT IN ('0000-00-00', '1111-11-11')
     WHERE ce.id = ?
     GROUP BY ce.id`,
    [eventId]
  );
  return rows?.[0] || null;
}

async function getReinstateOptions(pool, bookingIdParam, { courseId } = {}) {
  const bookingId = Number(bookingIdParam);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    throw httpError('Invalid booking id');
  }

  const booking = await loadBooking(pool, bookingId);
  if (!booking) throw httpError('Booking not found', 404);
  if (!canReinstateBooking(booking)) {
    throw httpError('This booking is not on hold');
  }

  const currentEventId = Number(booking.course_event_id);
  const filterCourseId = Number(courseId) || Number(booking.course_id);
  const today = getCurrentMysqlDateTime().slice(0, 10);

  const [courseRows] = await pool.query(
    `SELECT id, course_name
     FROM courses
     WHERE (isDeleted = '0' OR isDeleted = 0 OR isDeleted IS NULL)
       AND status IN ('1', '2', 1, 2)
     ORDER BY course_name ASC`
  );

  const [rows] = await pool.query(
    `SELECT
       ce.id AS course_event_id,
       ce.course_id,
       c.course_name,
       l.location_name,
       DATE_FORMAT(MIN(ced.event_date), '%Y-%m-%d') AS event_date,
       MIN(ced.event_start_time) AS event_start_time,
       MIN(ced.event_end_time) AS event_end_time,
       ce.booking_limit,
       ce.bookings_done,
       ce.current_locks
     FROM course_events ce
     JOIN courses c ON c.id = ce.course_id
     JOIN course_event_dates ced ON ced.course_event_id = ce.id
     LEFT JOIN locations l ON l.id = ce.location_id
     LEFT JOIN freeze f ON f.course_event_id = ce.id
     WHERE ce.course_id = ?
       AND ce.status IN ('1', 1)
       AND ced.event_date >= ?
       AND ced.event_date > '1900-01-01'
       AND ced.event_date NOT IN ('0000-00-00', '1111-11-11')
       AND f.id IS NULL
     GROUP BY ce.id, ce.course_id, c.course_name, l.location_name,
              ce.booking_limit, ce.bookings_done, ce.current_locks
     HAVING (ce.booking_limit - ce.bookings_done - COALESCE(ce.current_locks, 0)) > 0
         OR ce.id = ?
     ORDER BY event_date ASC, l.location_name ASC, event_start_time ASC`,
    [filterCourseId, today, currentEventId]
  );

  const events = [];
  const seen = new Set();

  if (Number(filterCourseId) === Number(booking.course_id)) {
    const currentRow = await loadEventOption(pool, currentEventId);
    if (currentRow) {
      events.push(buildEventOption(currentRow, { isCurrent: true }));
      seen.add(currentEventId);
    }
  }

  for (const row of rows || []) {
    const eventId = Number(row.course_event_id);
    if (seen.has(eventId)) continue;
    const eventDate = toMysqlDateKey(row.event_date);
    if (!eventDate || eventDate < today) continue;
    events.push(buildEventOption(row, { isCurrent: eventId === currentEventId }));
    seen.add(eventId);
  }

  const currentHasSpace = events.some(
    (event) => event.is_current && event.spaces_available > 0
  );

  return {
    booking_id: bookingId,
    current_event_id: currentEventId,
    current_course_id: Number(booking.course_id),
    current_event_has_space: currentHasSpace,
    selected_course_id: filterCourseId,
    courses: (courseRows || []).map((row) => ({
      id: Number(row.id),
      label: row.course_name,
    })),
    events,
  };
}

async function reinstateBooking(pool, bookingIdParam, adminId = 0, options = {}) {
  const bookingId = Number(bookingIdParam);
  if (!Number.isFinite(bookingId) || bookingId <= 0) {
    throw httpError('Invalid booking id');
  }

  const notes = trim(options.notes);
  const requestedEventId = options.new_event_id
    ? Number(options.new_event_id)
    : 0;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const booking = await loadBooking(connection, bookingId);
    if (!booking) throw httpError('Booking not found', 404);
    if (!canReinstateBooking(booking)) {
      throw httpError('This booking is not on hold');
    }

    const attendee = await loadPrimaryAttendee(connection, bookingId);
    if (!attendee) throw httpError('Booking attendee not found', 404);

    const fromEventId = Number(booking.course_event_id);
    const targetEventId = requestedEventId || fromEventId;
    const targetEvent = await loadEventCapacity(connection, targetEventId);
    if (!targetEvent) throw httpError('Selected course date was not found', 404);
    if (Number(targetEvent.status) !== 1) {
      throw httpError('Selected course date is not available');
    }

    const returningToOriginal = targetEventId === fromEventId;
    if (!returningToOriginal) {
      if (await isEventFrozen(connection, targetEventId)) {
        throw httpError('Selected course date is frozen');
      }
      if (!eventHasSpace(targetEvent, Number(booking.spaces) || 1)) {
        throw httpError(
          'This date has no remaining spaces. Please choose another course date and location.'
        );
      }
    }

    await applySeatChange(
      connection,
      targetEventId,
      attendee.vehicle_type,
      'consume'
    );

    const now = getCurrentMysqlDateTime();
    await connection.query(
      `UPDATE bookings
       SET on_hold = 0,
           on_hold_at = NULL,
           on_hold_by_admin_id = 0,
           course_event_id = ?,
           course_id = ?,
           modified = ?
       WHERE id = ?`,
      [targetEventId, targetEvent.course_id, now, bookingId]
    );

    const moved = targetEventId !== fromEventId;
    const noteSuffix = notes ? ` — ${notes}` : '';
    const statusMessage = moved
      ? `Booking reinstated and moved to event ${targetEventId}${noteSuffix}`
      : `Booking reinstated to original course date${noteSuffix}`;

    await writeAudit(connection, {
      bookingId,
      adminId,
      type: 'reinstated',
      status: statusMessage,
      action: 'reinstated',
      fromEventId,
      toEventId: targetEventId,
      notes,
    });

    await connection.commit();

    let confirmationEmailSent = false;
    try {
      const emailResult = await sendAdminBookingConfirmationEmail(pool, bookingId, {
        logType: 'Updated Booking Confirmation',
      });
      confirmationEmailSent = Boolean(emailResult?.sent);
      if (!confirmationEmailSent) {
        console.warn(
          `[ADMIN][BOOKING][REINSTATE] confirmation email not sent for booking ${bookingId}: ${emailResult?.reason || 'unknown'}`
        );
      }
    } catch (emailError) {
      console.error(
        `[ADMIN][BOOKING][REINSTATE] confirmation email failed for booking ${bookingId}:`,
        emailError
      );
    }

    const baseMessage = moved
      ? 'Booking reinstated onto the selected course date.'
      : 'Booking reinstated. Course capacity has been reserved again.';
    const emailSuffix = confirmationEmailSent
      ? ' An updated booking confirmation has been emailed to the attendee.'
      : '';

    return {
      booking_id: bookingId,
      course_event_id: targetEventId,
      previous_event_id: fromEventId,
      on_hold: 0,
      moved,
      confirmation_email_sent: confirmationEmailSent,
      message: `${baseMessage}${emailSuffix}`,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  isOnHold,
  isEventDatePassed,
  getLatestEventDateFromRows,
  canHoldBooking,
  canReinstateBooking,
  holdBooking,
  reinstateBooking,
  getReinstateOptions,
};
