const { sendFeedbackMail } = require('./adminBookingMailService');
const { getLocationSelectOptions } = require('./courseEventWizardService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function vTypeSelectLabels() {
  return {
    '0': 'Manual',
    '1': 'Automatic',
    '3': 'I will be using my own vehicle',
  };
}

function htmlEntities(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br(text) {
  return String(text || '')
    .replace(/\r\n/g, '<br />')
    .replace(/\n/g, '<br />')
    .replace(/\r/g, '<br />');
}

function normalizeDay(day) {
  const value = trim(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date().toISOString().slice(0, 10);
  }
  return value;
}

function shiftDay(day, delta) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dayOfMonthKey(day) {
  return String(new Date(`${day}T12:00:00`).getDate()).padStart(2, '0');
}

function feedKey(bookingId, day) {
  return `${bookingId}${dayOfMonthKey(day)}`;
}

function formatDayLabel(day) {
  const d = new Date(`${day}T12:00:00`);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  const dayNum = d.getDate();
  const suffix =
    dayNum > 3 && dayNum < 21
      ? 'th'
      : ['th', 'st', 'nd', 'rd'][dayNum % 10 > 3 ? 0 : dayNum % 10] || 'th';
  return `${weekday} ${month} ${dayNum}${suffix} ${d.getFullYear()}`;
}

async function getReportOptions(pool) {
  const [rows] = await pool.query(
    "SELECT id, `option`, weight FROM itinary_result_options ORDER BY FIELD(`option`, 'Passed') DESC, weight ASC"
  );
  return rows || [];
}

async function queryVehicleStatusGroupForLocation(pool, column, fieldOrder, locationId) {
  const fieldList = fieldOrder.map((color) => `'${color}'`).join(', ');
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt, ${column} AS color
     FROM vehicles
     WHERE location_id = ? AND include_into_alert = 1 AND status = 1
     GROUP BY ${column}
     ORDER BY FIELD(${column}, ${fieldList})`,
    [locationId]
  );
  return (rows || []).map((row) => ({
    cnt: Number(row.cnt) || 0,
    color: row.color,
  }));
}

async function getVehicleHeaderStatusForLocation(pool, locationId) {
  const [issue, mot, road_tax, service] = await Promise.all([
    queryVehicleStatusGroupForLocation(pool, 'issue_color', [
      'green',
      'red',
      'yellow',
      'purple',
    ], locationId),
    queryVehicleStatusGroupForLocation(pool, 'mot_color', ['green', 'red', 'yellow'], locationId),
    queryVehicleStatusGroupForLocation(pool, 'road_tax_color', [
      'green',
      'red',
      'yellow',
      'blue',
    ], locationId),
    queryVehicleStatusGroupForLocation(pool, 'service_color', [
      'green',
      'red',
      'yellow',
    ], locationId),
  ]);
  return { issue, mot, road_tax, service };
}

async function getItinaryBookings(pool, day) {
  const [rows] = await pool.query(
    `SELECT bookings.id, bookings.course_event_id, bookings.course_id, location_id,
      bookings.status, first_name, sur_name, contact1, contact2, contact3,
      admin_notes, notes, email, vehicle_type, license_number, course_name,
      course_events.course_id AS course_event_course_id, event_type
     FROM bookings
     LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     LEFT JOIN course_events ON course_events.id = bookings.course_event_id
     LEFT JOIN course_event_dates ON course_event_dates.course_event_id = bookings.course_event_id
     LEFT JOIN courses ON courses.id = bookings.course_id
     WHERE event_date = ? AND bookings.status = 1
     ORDER BY course_event_dates.event_start_time`,
    [day]
  );

  const grouped = {};
  for (const row of rows || []) {
    const locationId = row.location_id;
    const eventId = row.course_event_id;
    const courseId = row.course_id;
    if (!grouped[locationId]) grouped[locationId] = {};
    if (!grouped[locationId][eventId]) grouped[locationId][eventId] = {};
    if (!grouped[locationId][eventId][courseId]) grouped[locationId][eventId][courseId] = [];
    grouped[locationId][eventId][courseId].push(row);
  }
  return grouped;
}

async function getEventItinary(pool, id, day) {
  const [eventRows] = await pool.query(
    'SELECT * FROM course_events WHERE id = ? LIMIT 1',
    [Number(id)]
  );
  const itiEvt = eventRows[0];
  if (!itiEvt) {
    return null;
  }

  const eventsData = {
    event_type: itiEvt.event_type,
    event_start_time: '',
    event_end_time: '',
    dayCnt: 0,
    last_date: '',
  };

  const [dates] = await pool.query(
    `SELECT * FROM course_event_dates
     WHERE course_event_id = ? AND event_date != '0000-00-00'
     ORDER BY event_date`,
    [Number(id)]
  );

  let dayCounter = 0;
  for (const dt of dates || []) {
    dayCounter += 1;
    if (String(dt.event_date).slice(0, 10) === day) {
      eventsData.event_start_time = dt.event_start_time || '';
      eventsData.event_end_time = dt.event_end_time || '';
      eventsData.dayCnt = dayCounter;
    }
    eventsData.last_date = String(dt.event_date).slice(0, 10);
  }

  return eventsData;
}

async function getCourseById(pool, courseId) {
  const [rows] = await pool.query('SELECT * FROM courses WHERE id = ? LIMIT 1', [
    Number(courseId),
  ]);
  return rows[0] || null;
}

async function getDayNote(pool, day) {
  const [rows] = await pool.query(
    'SELECT day_note FROM itinary_note WHERE note_date = ? LIMIT 1',
    [day]
  );
  return rows[0]?.day_note == null ? '' : String(rows[0].day_note);
}

async function saveDayNote(pool, day, note) {
  const dayNote = trim(note);
  if (!dayNote) {
    return { ok: false, message: 'Day note can not be left blank' };
  }

  await pool.query('DELETE FROM itinary_note WHERE note_date = ?', [day]);
  const [result] = await pool.query(
    'INSERT INTO itinary_note (day_note, note_date) VALUES (?, ?)',
    [dayNote, day]
  );

  if (!result?.affectedRows) {
    return { ok: false, message: 'Error in updating' };
  }

  return { ok: true, message: 'Day Note Updated successfully' };
}

async function getEventDatesForBooking(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT course_event_dates.event_date
     FROM course_event_dates
     LEFT JOIN course_events ON course_events.id = course_event_dates.course_event_id
     LEFT JOIN bookings ON bookings.course_event_id = course_events.id
     WHERE bookings.id = ?`,
    [Number(bookingId)]
  );
  return (rows || [])
    .map((row) => String(row.event_date).slice(0, 10))
    .filter((value) => value && value !== '0000-00-00');
}

async function findStudentReport(pool, bookingId, eventDates) {
  if (!eventDates.length) {
    return null;
  }
  const placeholders = eventDates.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT id, report, result_description, updated_by, updated_by_name, updated_by_id
     FROM student_daily_report
     WHERE booking_id = ? AND report_day IN (${placeholders})
     LIMIT 1`,
    [Number(bookingId), ...eventDates]
  );
  return rows[0] || null;
}

async function resolveUpdatedByName(pool, report) {
  if (!report) return '';
  if (trim(report.updated_by_name)) {
    return trim(report.updated_by_name);
  }
  if (Number(report.updated_by) === 0 && report.updated_by_id) {
    const [rows] = await pool.query(
      "SELECT CONCAT(admin_fristname, ' ', admin_lastname) AS admin_name FROM admin WHERE admin_id = ? LIMIT 1",
      [report.updated_by_id]
    );
    return trim(rows[0]?.admin_name);
  }
  if (report.updated_by_id) {
    const [rows] = await pool.query(
      "SELECT CONCAT(fname, ' ', lname) AS ins_name FROM itineraries WHERE id = ? LIMIT 1",
      [report.updated_by_id]
    );
    return trim(rows[0]?.ins_name);
  }
  return '';
}

function mapReportForClient(report, bookingId, day) {
  if (!report) {
    return {
      report: 0,
      result_description: '',
      updated_by_name: '',
      feed_key: feedKey(bookingId, day),
      oldval: 0,
      oldval_textarea: '',
    };
  }

  const description = report.result_description == null ? '' : String(report.result_description);
  return {
    report: Number(report.report) || 0,
    result_description: description,
    updated_by_name: '',
    feed_key: feedKey(bookingId, day),
    oldval: Number(report.report) || 0,
    oldval_textarea: description.replace(/<br\s*\/?>/gi, ''),
  };
}

async function loadReportMaps(pool, day, groupedBookings) {
  const [singleReports] = await pool.query(
    `SELECT date_bid, report, result_description, updated_by, updated_by_name, updated_by_id
     FROM student_daily_report WHERE report_day = ?`,
    [day]
  );
  const singleMap = new Map(
    (singleReports || []).map((row) => [String(row.date_bid), row])
  );

  const multiBookingIds = new Set();
  for (const locationEvents of Object.values(groupedBookings)) {
    for (const [eventId, courseGroups] of Object.entries(locationEvents)) {
      const eventMeta = await getEventItinary(pool, eventId, day);
      if (eventMeta?.event_type !== 'multi') continue;
      for (const bookings of Object.values(courseGroups)) {
        for (const booking of bookings) {
          multiBookingIds.add(Number(booking.id));
        }
      }
    }
  }

  const multiMap = new Map();
  if (multiBookingIds.size) {
    const ids = [...multiBookingIds];
    const [multiReports] = await pool.query(
      `SELECT booking_id, report, result_description, updated_by, updated_by_name, updated_by_id
       FROM student_daily_report
       WHERE booking_id IN (?)
       GROUP BY booking_id`,
      [ids]
    );
    for (const row of multiReports || []) {
      multiMap.set(feedKey(row.booking_id, day), row);
    }
  }

  return { singleMap, multiMap };
}

async function getItineraryDay(pool, query = {}) {
  const day = normalizeDay(query.day);
  const locations = await getLocationSelectOptions(pool);
  const groupedBookings = await getItinaryBookings(pool, day);
  const resultOptions = await getReportOptions(pool);
  const dayNote = await getDayNote(pool, day);
  const { singleMap, multiMap } = await loadReportMaps(pool, day, groupedBookings);

  const locationBlocks = [];
  let hasBookings = false;

  for (const loc of locations) {
    const locationId = Number(loc.id);
    const locationEvents = groupedBookings[locationId];
    if (!locationEvents) continue;

    hasBookings = true;
    const vehicleStatus = await getVehicleHeaderStatusForLocation(pool, locationId);
    const events = [];

    for (const [eventIdRaw, courseGroups] of Object.entries(locationEvents)) {
      const eventId = Number(eventIdRaw);
      const eventMeta = (await getEventItinary(pool, eventId, day)) || {
        event_type: 'single',
        event_start_time: '',
        event_end_time: '',
        dayCnt: 0,
        last_date: day,
      };

      for (const bookings of Object.values(courseGroups)) {
        if (!bookings.length) continue;
        const courseData = await getCourseById(
          pool,
          bookings[0].course_event_course_id
        );
        const bookingsOut = [];

        for (const booking of bookings) {
          const bookingId = Number(booking.id);
          const key = feedKey(bookingId, day);
          const reportRow =
            eventMeta.event_type === 'multi'
              ? multiMap.get(key)
              : singleMap.get(key);
          const result = mapReportForClient(reportRow, bookingId, day);
          result.updated_by_name = await resolveUpdatedByName(pool, reportRow);

          bookingsOut.push({
            id: bookingId,
            course_event_id: Number(booking.course_event_id),
            first_name: trim(booking.first_name),
            sur_name: trim(booking.sur_name),
            contact1: trim(booking.contact1),
            contact2: trim(booking.contact2),
            contact3: trim(booking.contact3),
            email: trim(booking.email),
            vehicle_type: String(booking.vehicle_type ?? ''),
            vehicle_type_label:
              vTypeSelectLabels()[String(booking.vehicle_type)] || '',
            license_number: trim(booking.license_number),
            notes: booking.notes == null ? '' : String(booking.notes),
            admin_notes:
              booking.admin_notes == null ? '' : String(booking.admin_notes),
            result,
          });
        }

        events.push({
          course_event_id: eventId,
          course_id: Number(bookings[0].course_event_course_id),
          course_name: trim(courseData?.course_name || bookings[0].course_name),
          send_feedback_mail: Number(courseData?.send_feedback_mail) === 1 ? 1 : 0,
          event_type: eventMeta.event_type,
          day_cnt: eventMeta.dayCnt,
          event_start_time: eventMeta.event_start_time,
          event_end_time: eventMeta.event_end_time,
          last_date: eventMeta.last_date,
          bookings: bookingsOut,
        });
      }
    }

    locationBlocks.push({
      id: locationId,
      location_name: trim(loc.location_name),
      vehicle_status: vehicleStatus,
      events,
    });
  }

  return {
    day,
    day_label: formatDayLabel(day),
    prev_day: shiftDay(day, -1),
    next_day: shiftDay(day, 1),
    day_note: dayNote,
    result_options: (resultOptions || []).map((row) => ({
      id: Number(row.id),
      option: row.option,
      weight: Number(row.weight) || 0,
    })),
    vehicle_type_labels: vTypeSelectLabels(),
    locations: locationBlocks,
    has_bookings: hasBookings,
  };
}

async function saveStudentResults(pool, day, body, session) {
  const dayResultSave = normalizeDay(body.day_result_save || day);
  const feedback = body.feedback || {};
  const oldval = body.oldval || {};
  const resultDescription = body.result_description || {};
  const isRecChanged = body.is_rec_changed || {};
  const sendFeedbackMailMap = body.send_feedback_mail || {};

  const updatedbyname = `${trim(session.admin_fristname)} ${trim(session.admin_lastname)}`.trim();
  const updatedbyid = session.loggedinAdmin?.admin_id || session.admin_id;

  for (const [bookingIdStr, feedbackValue] of Object.entries(feedback)) {
    const bookingId = Number(bookingIdStr);
    if (!Number.isFinite(bookingId) || bookingId <= 0) continue;

    let reportValue = feedbackValue;
    if (reportValue === '' || reportValue == null) {
      reportValue = 0;
    }
    reportValue = Number(reportValue);

    const eventDates = await getEventDatesForBooking(pool, bookingId);
    const previousValue = Number(oldval[bookingIdStr] || 0);
    const recordChanged = Number(isRecChanged[bookingIdStr] || 0);

    if (previousValue !== reportValue) {
      const description = nl2br(htmlEntities(resultDescription[bookingIdStr] || ''));
      const existing = await findStudentReport(pool, bookingId, eventDates);

      if (existing) {
        if (recordChanged === 1) {
          let sql =
            'UPDATE student_daily_report SET report = ?, result_description = ?';
          const params = [reportValue, description];
          if (
            Number(existing.report) !== reportValue ||
            String(existing.result_description || '') !== description
          ) {
            sql += ', updated_by = 0, updated_by_name = ?, updated_by_id = ?';
            params.push(updatedbyname, updatedbyid);
          }
          sql += ' WHERE id = ?';
          params.push(existing.id);
          await pool.query(sql, params);
        }
      } else if (recordChanged === 1) {
        const dateBid = `${bookingId}${dayOfMonthKey(dayResultSave)}`;
        await pool.query(
          `INSERT INTO student_daily_report
            (date_bid, report, report_day, booking_id, result_description, updated_by, updated_by_name, updated_by_id)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          [
            dateBid,
            reportValue,
            dayResultSave,
            bookingId,
            description,
            updatedbyname,
            updatedbyid,
          ]
        );
      }

      if (reportValue === 1 && Number(sendFeedbackMailMap[bookingIdStr]) === 1) {
        await sendFeedbackMail(pool, bookingId);
      }
    } else if (reportValue > 0) {
      const existing = await findStudentReport(pool, bookingId, eventDates);
      if (existing && recordChanged === 1) {
        const description = nl2br(htmlEntities(resultDescription[bookingIdStr] || ''));
        const savedDesc = String(existing.result_description || '');
        if (savedDesc !== description) {
          await pool.query(
            `UPDATE student_daily_report
             SET result_description = ?, updated_by = 0, updated_by_name = ?, updated_by_id = ?
             WHERE id = ?`,
            [description, updatedbyname, updatedbyid, existing.id]
          );
        }
      }
    }
  }

  return { ok: true, message: 'Results save successfully' };
}

module.exports = {
  getItineraryDay,
  saveDayNote,
  saveStudentResults,
};
