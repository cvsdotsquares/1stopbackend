const { getCurrentMysqlDateTime } = require('../../utils/dateFormat');
const { getVehicleHeaderStatus } = require('../../admin/services/headerService');
const { sendAdminBookingFeedbackEmail } = require('../../admin/services/adminBookingEmailService');

const VEHICLE_TYPE_LABELS = {
  0: 'Manual',
  1: 'Automatic',
  3: 'I will be using my own vehicle',
};

function trim(value) {
  return value == null ? '' : String(value).trim();
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
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }
  return '';
}

function normalizeDayParam(dayParam) {
  const key = toMysqlDateKey(dayParam);
  if (!key || key === '0000-00-00') {
    return getCurrentMysqlDateTime().slice(0, 10);
  }
  return key;
}

function shiftDay(day, deltaDays) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDayHeading(day) {
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
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
  const dayNum = d.getDate();
  const suffix =
    dayNum % 10 === 1 && dayNum !== 11
      ? 'st'
      : dayNum % 10 === 2 && dayNum !== 12
        ? 'nd'
        : dayNum % 10 === 3 && dayNum !== 13
          ? 'rd'
          : 'th';
  return `${weekdays[d.getDay()]} ${months[d.getMonth()]} ${dayNum}${suffix} ${d.getFullYear()}`;
}

function formatTimeLabel(value) {
  if (!value) return '';
  const raw = String(value).slice(0, 5);
  const [h, m] = raw.split(':');
  const hour = Number(h);
  if (!Number.isFinite(hour)) return raw;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m || '00'}${suffix}`;
}

function resultFeedKey(bookingId, day) {
  const d = new Date(`${day}T12:00:00`);
  const dayPart = String(d.getDate()).padStart(2, '0');
  return `${bookingId}${dayPart}`;
}

function decodeResultDescription(value) {
  if (!value) return '';
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function encodeResultDescription(value) {
  const raw = trim(value);
  if (!raw) return '';
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\r?\n/g, '<br />');
}

async function getDayNote(pool, day) {
  const [rows] = await pool.query(
    'SELECT day_note FROM itinary_note WHERE note_date = ? LIMIT 1',
    [day]
  );
  return rows?.[0]?.day_note || '';
}

async function getResultOptions(pool) {
  const [rows] = await pool.query(
    `SELECT id, \`option\`, weight
     FROM itinary_result_options
     ORDER BY FIELD(\`option\`, 'Passed') DESC, weight ASC`
  );
  return (rows || []).map((row) => ({
    id: Number(row.id),
    option: row.option,
    weight: Number(row.weight) || 0,
  }));
}

async function getEventItineraryMeta(pool, eventId, day) {
  const [eventRows] = await pool.query(
    'SELECT event_type FROM course_events WHERE id = ? LIMIT 1',
    [eventId]
  );
  const eventType = eventRows?.[0]?.event_type || 'single';
  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates
     WHERE course_event_id = ? AND event_date != '0000-00-00'
     ORDER BY event_date ASC`,
    [eventId]
  );

  let dayNumber = null;
  let eventStartTime = '';
  let eventEndTime = '';
  let lastDate = '';
  let idx = 0;
  for (const row of dateRows || []) {
    idx += 1;
    const dateKey = toMysqlDateKey(row.event_date);
    lastDate = dateKey;
    if (dateKey === day) {
      dayNumber = idx;
      eventStartTime = row.event_start_time || '';
      eventEndTime = row.event_end_time || '';
    }
  }

  return {
    event_type: eventType,
    day_number: dayNumber,
    event_start_time: eventStartTime,
    event_end_time: eventEndTime,
    event_start_label: formatTimeLabel(eventStartTime),
    event_end_label: formatTimeLabel(eventEndTime),
    last_event_date: lastDate,
  };
}

async function checkLicenceHasMultipleBookings(pool, licenceNumber, bookingId) {
  if (!licenceNumber || !bookingId) return false;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM booking_attendees
     LEFT JOIN bookings ON booking_attendees.booking_id = bookings.id
     WHERE license_number = ? AND booking_id <> ? AND bookings.status IN (1, 2)`,
    [licenceNumber.trim(), bookingId]
  );
  return Number(rows?.[0]?.cnt || 0) > 0;
}

async function loadReportsForDay(pool, day, eventType, bookingIds) {
  const reportsByKey = new Map();
  if (!bookingIds.length) return reportsByKey;

  if (eventType === 'multi') {
    const placeholders = bookingIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT booking_id, report, result_description, updated_by, updated_by_name, updated_by_id
       FROM student_daily_report
       WHERE booking_id IN (${placeholders})
       GROUP BY booking_id`,
      bookingIds
    );
    for (const row of rows || []) {
      reportsByKey.set(resultFeedKey(row.booking_id, day), row);
    }
    return reportsByKey;
  }

  const [rows] = await pool.query(
    `SELECT date_bid, report, result_description, updated_by, updated_by_name, updated_by_id
     FROM student_daily_report
     WHERE report_day = ?`,
    [day]
  );
  for (const row of rows || []) {
    reportsByKey.set(String(row.date_bid), row);
  }
  return reportsByKey;
}

async function resolveUpdatedByLabel(pool, row) {
  if (!row) return '';
  if (Number(row.updated_by) === 0) {
    if (row.updated_by_name) return row.updated_by_name;
    if (row.updated_by_id) {
      const [adminRows] = await pool.query(
        `SELECT CONCAT(admin_fristname, ' ', admin_lastname) AS admin_name
         FROM admin WHERE admin_id = ? LIMIT 1`,
        [row.updated_by_id]
      );
      return adminRows?.[0]?.admin_name || 'Admin';
    }
    return 'Admin';
  }
  if (row.updated_by_id) {
    const [insRows] = await pool.query(
      `SELECT CONCAT(fname, ' ', lname) AS ins_name FROM itineraries WHERE id = ? LIMIT 1`,
      [row.updated_by_id]
    );
    return insRows?.[0]?.ins_name || 'Instructor';
  }
  return 'Instructor';
}

async function getBookingEventDates(connection, bookingId) {
  const [rows] = await connection.query(
    `SELECT course_event_dates.event_date
     FROM course_event_dates
     LEFT JOIN course_events ON course_events.id = course_event_dates.course_event_id
     LEFT JOIN bookings ON bookings.course_event_id = course_events.id
     WHERE bookings.id = ?`,
    [bookingId]
  );
  return (rows || [])
    .map((row) => toMysqlDateKey(row.event_date))
    .filter(Boolean);
}

/**
 * Legacy parity: public_html/instructor/index.php
 * Fetches the daily itinerary for the instructor portal.
 */
async function getInstructorDailyItinerary(pool, dayParam, instructorId) {
  const day = normalizeDayParam(dayParam);

  const [locations, dayNote, bookingRows] = await Promise.all([
    pool.query(
      "SELECT id, location_name FROM locations WHERE status = '1' ORDER BY location_name ASC"
    ).then(([rows]) => rows || []),
    getDayNote(pool, day),
    pool.query(
      `SELECT bookings.id, bookings.course_event_id, bookings.course_id, bookings.status,
              course_events.location_id, course_events.event_type,
              booking_attendees.first_name, booking_attendees.sur_name,
              booking_attendees.contact1, booking_attendees.contact2, booking_attendees.contact3,
              booking_attendees.admin_notes, booking_attendees.notes, booking_attendees.email,
              booking_attendees.vehicle_type, booking_attendees.license_number,
              courses.course_name, courses.send_feedback_mail,
              course_events.course_id AS course_event_course_id,
              course_event_dates.event_start_time
       FROM bookings
       LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
       LEFT JOIN course_events ON course_events.id = bookings.course_event_id
       INNER JOIN course_event_dates ON course_event_dates.course_event_id = bookings.course_event_id
         AND course_event_dates.event_date = ?
       LEFT JOIN courses ON courses.id = bookings.course_id
       WHERE bookings.status = 1
         AND IFNULL(bookings.on_hold, 0) = 0
         AND bookings.course_event_id NOT IN (SELECT course_event_id FROM freeze)
       ORDER BY course_event_dates.event_start_time ASC, booking_attendees.first_name ASC`,
      [day]
    ).then(([rows]) => rows || []),
  ]);

  const grouped = new Map();
  for (const row of bookingRows) {
    const locationId = Number(row.location_id);
    const eventId = Number(row.course_event_id);
    const courseId = Number(row.course_id);
    if (!grouped.has(locationId)) grouped.set(locationId, new Map());
    const byEvent = grouped.get(locationId);
    if (!byEvent.has(eventId)) byEvent.set(eventId, new Map());
    const byCourse = byEvent.get(eventId);
    if (!byCourse.has(courseId)) byCourse.set(courseId, []);
    byCourse.get(courseId).push(row);
  }

  const locationPayload = [];
  for (const loc of locations) {
    const locationId = Number(loc.id);
    const eventMap = grouped.get(locationId);
    if (!eventMap || eventMap.size === 0) continue;

    const vehicleStatus = await getVehicleHeaderStatus(pool, locationId);
    const events = [];

    for (const [eventId, courseMap] of eventMap.entries()) {
      const eventMeta = await getEventItineraryMeta(pool, eventId, day);
      for (const [courseId, bookings] of courseMap.entries()) {
        if (!bookings.length) continue;
        const first = bookings[0];

        const bookingPayload = [];
        for (const b of bookings) {
          const hasMultiple = await checkLicenceHasMultipleBookings(
            pool,
            b.license_number,
            b.id
          );

          const hasNoContacts =
            !trim(b.contact1) && !trim(b.contact2) && !trim(b.contact3);
          const contactMissing =
            hasNoContacts || !trim(b.email) || !trim(b.license_number);

          bookingPayload.push({
            id: Number(b.id),
            first_name: b.first_name || '',
            sur_name: b.sur_name || '',
            contact1: b.contact1 || '',
            contact2: b.contact2 || '',
            contact3: b.contact3 || '',
            email: b.email || '',
            vehicle_type: b.vehicle_type,
            vehicle_type_label:
              VEHICLE_TYPE_LABELS[b.vehicle_type] ||
              VEHICLE_TYPE_LABELS[String(b.vehicle_type)] ||
              'Manual',
            license_number: b.license_number || '',
            notes: b.notes || '',
            has_multiple_booking: hasMultiple,
            contact_missing: contactMissing,
          });
        }

        events.push({
          course_event_id: eventId,
          course_id: courseId,
          course_name: first.course_name || 'Course',
          event_type: eventMeta.event_type,
          day_number: eventMeta.day_number,
          event_start_time: eventMeta.event_start_time,
          event_end_time: eventMeta.event_end_time,
          event_start_label: eventMeta.event_start_label,
          event_end_label: eventMeta.event_end_label,
          bookings: bookingPayload,
        });
      }
    }

    locationPayload.push({
      location_id: locationId,
      location_name: loc.location_name,
      vehicle_status: vehicleStatus,
      events,
    });
  }

  return {
    day,
    day_formatted: formatDayHeading(day),
    prev_day: shiftDay(day, -1),
    next_day: shiftDay(day, 1),
    day_note: dayNote,
    locations: locationPayload,
  };
}

/**
 * Legacy parity: public_html/instructor/result_updates.php
 * Fetches the daily student results form data.
 */
async function getInstructorResultsPage(pool, dayParam) {
  const day = normalizeDayParam(dayParam);
  const today = getCurrentMysqlDateTime().slice(0, 10);

  const [locations, resultOptions, bookingRows] = await Promise.all([
    pool.query(
      "SELECT id, location_name FROM locations WHERE status = '1' ORDER BY location_name ASC"
    ).then(([rows]) => rows || []),
    getResultOptions(pool),
    pool.query(
      `SELECT bookings.id, bookings.course_event_id, bookings.course_id, bookings.status,
              course_events.location_id, course_events.event_type,
              booking_attendees.first_name, booking_attendees.sur_name,
              booking_attendees.license_number,
              courses.course_name, courses.send_feedback_mail,
              course_events.course_id AS course_event_course_id,
              course_event_dates.event_start_time
       FROM bookings
       LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
       LEFT JOIN course_events ON course_events.id = bookings.course_event_id
       INNER JOIN course_event_dates ON course_event_dates.course_event_id = bookings.course_event_id
         AND course_event_dates.event_date = ?
       LEFT JOIN courses ON courses.id = bookings.course_id
       WHERE bookings.status = 1
         AND IFNULL(bookings.on_hold, 0) = 0
         AND bookings.course_event_id NOT IN (SELECT course_event_id FROM freeze)
       ORDER BY course_event_dates.event_start_time ASC, booking_attendees.first_name ASC`,
      [day]
    ).then(([rows]) => rows || []),
  ]);

  const grouped = new Map();
  for (const row of bookingRows) {
    const locationId = Number(row.location_id);
    const eventId = Number(row.course_event_id);
    const courseId = Number(row.course_id);
    if (!grouped.has(locationId)) grouped.set(locationId, new Map());
    const byEvent = grouped.get(locationId);
    if (!byEvent.has(eventId)) byEvent.set(eventId, new Map());
    const byCourse = byEvent.get(eventId);
    if (!byCourse.has(courseId)) byCourse.set(courseId, []);
    byCourse.get(courseId).push(row);
  }

  const locationPayload = [];
  for (const loc of locations) {
    const locationId = Number(loc.id);
    const eventMap = grouped.get(locationId);
    if (!eventMap || eventMap.size === 0) continue;

    const events = [];
    for (const [eventId, courseMap] of eventMap.entries()) {
      const eventMeta = await getEventItineraryMeta(pool, eventId, day);
      for (const [courseId, bookings] of courseMap.entries()) {
        if (!bookings.length) continue;
        const first = bookings[0];
        const bookingIds = bookings.map((b) => Number(b.id));
        const reports = await loadReportsForDay(
          pool,
          day,
          eventMeta.event_type,
          bookingIds
        );

        const bookingPayload = [];
        for (const b of bookings) {
          const feedKey = resultFeedKey(b.id, day);
          const reportRow = reports.get(feedKey);
          const updatedByLabel = await resolveUpdatedByLabel(pool, reportRow);

          bookingPayload.push({
            id: Number(b.id),
            first_name: b.first_name || '',
            sur_name: b.sur_name || '',
            license_number: b.license_number || '',
            send_feedback_mail: Number(first.send_feedback_mail) || 0,
            report: reportRow ? Number(reportRow.report) || 0 : 0,
            result_description: decodeResultDescription(
              reportRow?.result_description
            ),
            updated_by: updatedByLabel,
          });
        }

        events.push({
          course_event_id: eventId,
          course_id: courseId,
          course_name: first.course_name || 'Course',
          event_type: eventMeta.event_type,
          day_number: eventMeta.day_number,
          event_start_time: eventMeta.event_start_time,
          event_end_time: eventMeta.event_end_time,
          event_start_label: eventMeta.event_start_label,
          event_end_label: eventMeta.event_end_label,
          bookings: bookingPayload,
        });
      }
    }

    locationPayload.push({
      location_id: locationId,
      location_name: loc.location_name,
      events,
    });
  }

  return {
    day,
    today,
    day_formatted: formatDayHeading(day),
    prev_day: shiftDay(day, -1),
    next_day: shiftDay(day, 1),
    result_options: resultOptions,
    locations: locationPayload,
  };
}

/**
 * Legacy parity: saving student results in result_updates.php
 */
async function saveInstructorResults(pool, dayParam, payload, instructorSession) {
  const day = normalizeDayParam(dayParam || payload.day_result_save);
  const feedback = payload.feedback || {};
  const oldval = payload.oldval || {};
  const resultDescription = payload.result_description || {};
  const isRecChanged = payload.is_rec_changed || {};
  const sendFeedbackMail = payload.send_feedback_mail || {};

  const instructorName = [
    trim(instructorSession?.fname),
    trim(instructorSession?.lname),
  ]
    .filter(Boolean)
    .join(' ') || 'Instructor';

  const instructorId = Number(instructorSession?.instructor_id || instructorSession?.id || 0);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const [bookingIdRaw, reportRaw] of Object.entries(feedback)) {
      const bookingId = Number(bookingIdRaw);
      if (!Number.isFinite(bookingId) || bookingId <= 0) continue;

      const reportValue = Number(reportRaw) || 0;
      const previousValue = Number(oldval[bookingIdRaw] || oldval[bookingId] || 0);
      const changedFlag = Number(
        isRecChanged[bookingIdRaw] || isRecChanged[bookingId] || 0
      );
      const descriptionRaw = trim(
        resultDescription[bookingIdRaw] ?? resultDescription[bookingId] ?? ''
      );
      const encodedDescription = encodeResultDescription(descriptionRaw);
      const eventDates = await getBookingEventDates(connection, bookingId);
      const dateBid = resultFeedKey(bookingId, day);

      if (previousValue !== reportValue) {
        if (!changedFlag) continue;

        const [existingRows] = await connection.query(
          eventDates.length
            ? `SELECT id, report, result_description
               FROM student_daily_report
               WHERE booking_id = ? AND report_day IN (${eventDates.map(() => '?').join(', ')})
               LIMIT 1`
            : `SELECT id, report, result_description
               FROM student_daily_report
               WHERE booking_id = ? AND report_day = ?
               LIMIT 1`,
          eventDates.length
            ? [bookingId, ...eventDates]
            : [bookingId, day]
        );
        const existing = existingRows?.[0];

        if (existing) {
          let sql = `UPDATE student_daily_report SET report = ?, result_description = ?`;
          const params = [reportValue, encodedDescription];
          if (
            Number(existing.report) !== reportValue ||
            String(existing.result_description || '') !== encodedDescription
          ) {
            sql += ', updated_by = ?, updated_by_name = ?, updated_by_id = ?';
            params.push(instructorId, instructorName, instructorId);
          }
          sql += ' WHERE id = ?';
          params.push(existing.id);
          await connection.query(sql, params);
        } else {
          await connection.query(
            `INSERT INTO student_daily_report
             (date_bid, report, report_day, booking_id, result_description, updated_by, updated_by_name, updated_by_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              dateBid,
              reportValue,
              day,
              bookingId,
              encodedDescription,
              instructorId,
              instructorName,
              instructorId,
            ]
          );
        }

        // Send feedback email if passed and course has send_feedback_mail enabled
        if (
          reportValue === 1 &&
          Number(sendFeedbackMail[bookingIdRaw] || sendFeedbackMail[bookingId]) === 1
        ) {
          await sendAdminBookingFeedbackEmail(pool, bookingId);
        }
      } else if (reportValue > 0 && changedFlag) {
        const [existingRows] = await connection.query(
          eventDates.length
            ? `SELECT id, result_description
               FROM student_daily_report
               WHERE booking_id = ? AND report_day IN (${eventDates.map(() => '?').join(', ')})
               LIMIT 1`
            : `SELECT id, result_description
               FROM student_daily_report
               WHERE booking_id = ? AND report_day = ?
               LIMIT 1`,
          eventDates.length
            ? [bookingId, ...eventDates]
            : [bookingId, day]
        );
        const existing = existingRows?.[0];
        if (existing && String(existing.result_description || '') !== encodedDescription) {
          await connection.query(
            `UPDATE student_daily_report
             SET result_description = ?, updated_by = ?, updated_by_name = ?, updated_by_id = ?
             WHERE id = ?`,
            [encodedDescription, instructorId, instructorName, instructorId, existing.id]
          );
        }
      }
    }

    await connection.commit();
    return { ok: true, day, message: 'Your results have now been successfully updated' };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Legacy parity: public_html/instructor/previous_results.php
 */
async function getPreviousResultsByLicence(pool, licenceNumber) {
  const licence = trim(licenceNumber);
  if (!licence) {
    return { ok: false, message: 'Licence number is required' };
  }

  const [rows] = await pool.query(
    `SELECT booking_attendees.*, bookings.id AS bid, bookings.course_id, bookings.course_event_id,
            courses.course_abb, courses.course_name, MIN(course_event_dates.event_date) AS event_date
     FROM booking_attendees
     LEFT JOIN bookings ON booking_attendees.booking_id = bookings.id
     LEFT JOIN courses ON bookings.course_id = courses.id
     LEFT JOIN course_event_dates ON bookings.course_event_id = course_event_dates.course_event_id
     WHERE booking_attendees.id != ''
       AND bookings.status IN (1, 2)
       AND course_event_dates.event_date != '0000-00-00'
       AND booking_attendees.license_number = ?
     GROUP BY bookings.id
     ORDER BY course_event_dates.event_date DESC`,
    [licence]
  );

  if (!rows || rows.length === 0) {
    return {
      ok: true,
      attendee_name: '',
      licence,
      records: [],
    };
  }

  const attendeeName = `${rows[0].first_name || ''} ${rows[0].sur_name || ''}`.trim();
  const records = [];

  for (const row of rows) {
    if (!row.bid) continue;

    const [reportRows] = await pool.query(
      `SELECT student_daily_report.*, itinary_result_options.option
       FROM student_daily_report
       JOIN itinary_result_options ON itinary_result_options.id = student_daily_report.report
       WHERE student_daily_report.booking_id = ?
       LIMIT 1`,
      [row.bid]
    );

    let result = 'Not yet submitted';
    let resultDescription = '';
    let updatedBy = '';

    if (reportRows && reportRows.length > 0) {
      const rep = reportRows[0];
      result = rep.option || 'Not yet submitted';
      resultDescription = decodeResultDescription(rep.result_description);

      if (Number(rep.updated_by) === 0) {
        if (rep.updated_by_name) {
          updatedBy = rep.updated_by_name;
        } else if (rep.updated_by_id) {
          const [adminRows] = await pool.query(
            `SELECT CONCAT(admin_fristname, ' ', admin_lastname) AS admin_name
             FROM admin WHERE admin_id = ? LIMIT 1`,
            [rep.updated_by_id]
          );
          updatedBy = adminRows?.[0]?.admin_name || 'Admin';
        } else {
          updatedBy = 'Admin';
        }
      } else {
        const [insRows] = await pool.query(
          `SELECT CONCAT(fname, ' ', lname) AS ins_name
           FROM itineraries WHERE id = ? LIMIT 1`,
          [rep.updated_by]
        );
        updatedBy = insRows?.[0]?.ins_name || 'Instructor';
      }
    }

    records.push({
      booking_id: Number(row.bid),
      event_date: toMysqlDateKey(row.event_date),
      course_name: row.course_name || '',
      result,
      result_description: resultDescription,
      updated_by: updatedBy,
    });
  }

  return {
    ok: true,
    attendee_name: attendeeName,
    licence,
    records,
  };
}

/**
 * Legacy parity: public_html/instructor/update_client_details.php
 */
async function getClientDetails(pool, bookingId) {
  const bid = Number(bookingId);
  if (!Number.isFinite(bid) || bid <= 0) {
    return { ok: false, message: 'Invalid booking ID' };
  }

  const [rows] = await pool.query(
    'SELECT * FROM booking_attendees WHERE booking_id = ? LIMIT 1',
    [bid]
  );

  if (!rows || rows.length === 0) {
    return { ok: false, message: 'Attendee details not found' };
  }

  return {
    ok: true,
    attendee: rows[0],
  };
}

/**
 * Legacy parity: update_client_details.php form submission
 */
async function updateClientDetails(pool, bookingId, data) {
  const bid = Number(bookingId);
  if (!Number.isFinite(bid) || bid <= 0) {
    return { ok: false, message: 'Invalid booking ID' };
  }

  const [existingRows] = await pool.query(
    'SELECT * FROM booking_attendees WHERE booking_id = ? LIMIT 1',
    [bid]
  );

  if (!existingRows || existingRows.length === 0) {
    return { ok: false, message: 'Attendee not found' };
  }

  const bres = existingRows[0];
  const contact1 = trim(data.contact1 || '').replace(/\s+/g, '');
  const contact2 = trim(data.contact2 || '').replace(/\s+/g, '');
  const contact3 = trim(data.contact3 || '').replace(/\s+/g, '');
  const email = trim(data.email || '');
  const licenceNo = trim(data.license_number || '').toUpperCase();
  const theoryNo = trim(data.theory_number || '');

  await pool.query(
    `UPDATE booking_attendees
     SET contact1 = ?, contact2 = ?, contact3 = ?, email = ?, license_number = ?, theory_number = ?
     WHERE booking_id = ?`,
    [contact1, contact2, contact3, email, licenceNo, theoryNo, bid]
  );

  if (bres.contact_card_id) {
    await pool.query(
      `UPDATE booking_attendees_dropdown
       SET contact1 = ?, contact2 = ?, contact3 = ?, email = ?, license_number = ?, theory_number = ?
       WHERE id = ?`,
      [contact1, contact2, contact3, email, licenceNo, theoryNo, bres.contact_card_id]
    );
  } else if (licenceNo) {
    const [matchRows] = await pool.query(
      'SELECT id FROM booking_attendees_dropdown WHERE license_number = ? LIMIT 1',
      [licenceNo]
    );
    if (matchRows && matchRows.length > 0) {
      await pool.query(
        `UPDATE booking_attendees_dropdown
         SET contact1 = ?, contact2 = ?, contact3 = ?, email = ?, theory_number = ?
         WHERE id = ?`,
        [contact1, contact2, contact3, email, theoryNo, matchRows[0].id]
      );
      await pool.query(
        'UPDATE booking_attendees SET contact_card_id = ? WHERE booking_id = ?',
        [matchRows[0].id, bid]
      );
    }
  }

  return {
    ok: true,
    message: 'Attendee details updated successfully',
  };
}

module.exports = {
  getInstructorDailyItinerary,
  getInstructorResultsPage,
  saveInstructorResults,
  getPreviousResultsByLicence,
  getClientDetails,
  updateClientDetails,
  getResultOptions,
};
