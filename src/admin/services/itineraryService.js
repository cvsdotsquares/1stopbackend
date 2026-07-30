/**
 * F-019 — Daily itinerary (legacy admin_itinary.php).
 */
const { getCurrentMysqlDateTime } = require('../../utils/dateFormat');
const { getVehicleHeaderStatus } = require('./headerService');
const { sendAdminBookingFeedbackEmail } = require('./adminBookingEmailService');

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

async function getDayNote(pool, day) {
  const [rows] = await pool.query(
    'SELECT day_note FROM itinary_note WHERE note_date = ? LIMIT 1',
    [day]
  );
  return rows?.[0]?.day_note || '';
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
  return '';
}

async function getDailyItinerary(pool, dayParam) {
  const day = normalizeDayParam(dayParam);
  const [locations, resultOptions, dayNote, bookingRows] = await Promise.all([
    pool.query(
      "SELECT id, location_name FROM locations WHERE status = '1' ORDER BY location_name ASC"
    ).then(([rows]) => rows || []),
    getResultOptions(pool),
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
              '',
            license_number: b.license_number || '',
            notes: b.notes || '',
            admin_notes: b.admin_notes || '',
            result_key: feedKey,
            result: {
              report_id: reportRow ? Number(reportRow.report) || 0 : 0,
              result_description: decodeResultDescription(
                reportRow?.result_description
              ),
              updated_by_label: await resolveUpdatedByLabel(pool, reportRow),
            },
          });
        }

        events.push({
          course_event_id: eventId,
          course_id: courseId,
          course_name: first.course_name || '',
          send_feedback_mail: Number(first.send_feedback_mail) === 1,
          ...eventMeta,
          bookings: bookingPayload,
        });
      }
    }

    if (events.length) {
      locationPayload.push({
        id: locationId,
        location_name: loc.location_name,
        vehicle_status: vehicleStatus,
        events,
      });
    }
  }

  return {
    day,
    day_label: formatDayHeading(day),
    prev_day: shiftDay(day, -1),
    next_day: shiftDay(day, 1),
    day_note: dayNote,
    result_options: resultOptions,
    locations: locationPayload,
    has_bookings: bookingRows.length > 0 && locationPayload.length > 0,
  };
}

async function saveDayNote(pool, dayParam, noteText) {
  const day = normalizeDayParam(dayParam);
  const note = trim(noteText);
  if (!note) {
    const err = new Error('Day note can not be left blank');
    err.status = 400;
    throw err;
  }

  await pool.query('DELETE FROM itinary_note WHERE note_date = ?', [day]);
  const [result] = await pool.query(
    'INSERT INTO itinary_note (day_note, note_date) VALUES (?, ?)',
    [note, day]
  );
  if (!result.affectedRows) {
    const err = new Error('Error in updating day note');
    err.status = 500;
    throw err;
  }
  return { day, message: 'Day Note Updated successfully' };
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

async function saveStudentResults(pool, dayParam, payload, adminSession) {
  const day = normalizeDayParam(dayParam || payload.day_result_save);
  const feedback = payload.feedback || {};
  const oldval = payload.oldval || {};
  const resultDescription = payload.result_description || {};
  const isRecChanged = payload.is_rec_changed || {};
  const sendFeedbackMail = payload.send_feedback_mail || {};

  const adminName = [
    trim(adminSession?.admin_fristname),
    trim(adminSession?.admin_lastname),
  ]
    .filter(Boolean)
    .join(' ');
  const adminId =
    Number(
      adminSession?.admin_id ||
        adminSession?.id ||
        adminSession?.loggedinAdmin?.admin_id
    ) || 0;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const [bookingIdRaw, reportRaw] of Object.entries(feedback)) {
      const bookingId = Number(bookingIdRaw);
      if (!Number.isFinite(bookingId) || bookingId <= 0) continue;

      let reportValue = Number(reportRaw) || 0;
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
        if (!changedFlag) {
          continue;
        }

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
          let sql = `UPDATE student_daily_report
                     SET report = ?, result_description = ?`;
          const params = [reportValue, encodedDescription];
          if (
            Number(existing.report) !== reportValue ||
            String(existing.result_description || '') !== encodedDescription
          ) {
            sql += ', updated_by = 0, updated_by_name = ?, updated_by_id = ?';
            params.push(adminName, adminId);
          }
          sql += ' WHERE id = ?';
          params.push(existing.id);
          await connection.query(sql, params);
        } else if (reportValue || encodedDescription) {
          await connection.query(
            `INSERT INTO student_daily_report
               (date_bid, report, report_day, booking_id, result_description,
                updated_by, updated_by_name, updated_by_id)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
            [
              dateBid,
              reportValue,
              day,
              bookingId,
              encodedDescription,
              adminName,
              adminId,
            ]
          );
        }

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
             SET result_description = ?, updated_by = 0, updated_by_name = ?, updated_by_id = ?
             WHERE id = ?`,
            [encodedDescription, adminName, adminId, existing.id]
          );
        }
      }
    }

    await connection.commit();
    return { day, message: 'Results save successfully' };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  getDailyItinerary,
  saveDayNote,
  saveStudentResults,
  getResultOptions,
};
