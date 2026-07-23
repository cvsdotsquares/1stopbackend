const RECORDS_PER_PAGE = 40;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildListWhere(searchterm = {}) {
  const conditions = ['1 = 1'];
  const params = [];
  let hasDateFilter = false;

  const courseId = trim(searchterm.name_scr);
  if (courseId) {
    conditions.push('courses.id = ?');
    params.push(Number(courseId));
  }

  const fromScr = trim(searchterm.from_scr);
  const toScr = trim(searchterm.to_scr);
  if (fromScr && toScr) {
    conditions.push('course_event_dates.event_date >= ?');
    params.push(fromScr);
    conditions.push('course_event_dates.event_date <= ?');
    params.push(toScr);
    hasDateFilter = true;
  } else if (fromScr) {
    conditions.push('course_event_dates.event_date >= ?');
    params.push(fromScr);
    hasDateFilter = true;
  } else if (toScr) {
    conditions.push('course_event_dates.event_date <= ?');
    params.push(toScr);
    hasDateFilter = true;
  }

  const locationId = trim(searchterm.loc_scr);
  if (locationId) {
    conditions.push('course_events.location_id = ?');
    params.push(Number(locationId));
  }

  if (!hasDateFilter) {
    conditions.push('course_event_dates.event_date >= CURDATE()');
  }

  return {
    where: `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

const LIST_SELECT = `
  SELECT DISTINCT course_events.id,
    courses.id AS cid,
    course_events.id AS course_event_id,
    course_events.school_one_off_price,
    course_events.school_deposit_price,
    course_events.school_total_price,
    course_events.status,
    course_events.event_type,
    course_events.created,
    courses.course_name,
    course_event_dates.id AS dateid,
    course_event_dates.event_start_time,
    course_event_dates.event_end_time,
    locations.id AS locationId,
    locations.location_name,
    course_events.booking_limit,
    course_event_dates.event_date,
    course_events.bookings_done,
    course_events.parent,
    course_events.current_locks
  FROM course_events
  JOIN locations ON course_events.location_id = locations.id
  JOIN courses ON courses.id = course_events.course_id
  JOIN course_event_dates ON course_events.id = course_event_dates.course_event_id
`;

const LIST_GROUP_ORDER = `
  GROUP BY course_events.course_id, course_events.parent
  ORDER BY course_event_dates.event_date ASC, course_events.id DESC
`;

const TBC_EVENT_DATE = '0000-00-00';

function normalizeSqlDateRaw(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return TBC_EVENT_DATE;
    const pad = (n) => String(n).padStart(2, '0');
    const year = value.getFullYear();
    if (year < 1901) return TBC_EVENT_DATE;
    return `${year}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const raw = trim(value);
  if (!raw || raw === TBC_EVENT_DATE || raw.startsWith('0000-00-00')) {
    return TBC_EVENT_DATE;
  }
  const datePart = raw.slice(0, 10);
  if (datePart === '1899-01-01' || datePart === '1111-11-11') {
    return TBC_EVENT_DATE;
  }
  return datePart;
}

function isTbcEventDate(value) {
  return normalizeSqlDateRaw(value) === TBC_EVENT_DATE;
}

function normalizeSqlDate(value) {
  const raw = normalizeSqlDateRaw(value);
  if (raw === TBC_EVENT_DATE) return '';
  return raw;
}

function formatDisplayDate(value) {
  const raw = normalizeSqlDate(value);
  if (!raw) return '';
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const day = String(d.getDate()).padStart(2, '0');
  return `${day}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function formatPriceLabel(row) {
  const oneOff = Number(row.school_one_off_price) || 0;
  const deposit = Number(row.school_deposit_price) || 0;
  if (oneOff > 0) return String(oneOff);
  if (deposit > 0) return String(row.school_total_price ?? '');
  return '';
}

function getRowStyle(isFrozen, eventDate) {
  const raw = normalizeSqlDate(eventDate);
  const day = raw ? new Date(`${raw}T12:00:00`).getDay() : -1;
  const isWeekend = day === 0 || day === 6;
  if (isFrozen && isWeekend) return { backgroundColor: '#ecddab' };
  if (isFrozen) return { backgroundColor: '#ecafab' };
  if (isWeekend) return { backgroundColor: '#cccc' };
  return null;
}

async function getFrozenMap(pool, eventIds) {
  if (!eventIds.length) return new Map();
  const [rows] = await pool.query(
    'SELECT * FROM freeze WHERE course_event_id IN (?)',
    [eventIds]
  );
  const map = new Map();
  for (const row of rows || []) {
    map.set(row.course_event_id, row);
  }
  return map;
}

function mapListRow(row, frozenMap) {
  const frozen = frozenMap.get(row.course_event_id);
  const isFrozen = Boolean(frozen);
  const bookingsDone = isFrozen
    ? String(frozen.bookings_done ?? row.bookings_done ?? '0')
    : String(row.bookings_done ?? '0');

  return {
    id: row.id,
    course_event_id: row.course_event_id,
    cid: row.cid,
    course_name: row.course_name,
    location_id: row.locationId,
    location_name: row.location_name,
    event_date: normalizeSqlDate(row.event_date),
    event_date_label: formatDisplayDate(row.event_date),
    event_start_time: row.event_start_time || '',
    event_end_time: row.event_end_time || '',
    time_label: `${row.event_start_time || ''} - ${row.event_end_time || ''}`,
    price_label: formatPriceLabel(row),
    school_one_off_price: row.school_one_off_price,
    school_deposit_price: row.school_deposit_price,
    school_total_price: row.school_total_price,
    bookings_done: bookingsDone,
    booking_limit: String(row.booking_limit ?? ''),
    event_type: row.event_type,
    parent: row.parent,
    status: String(row.status ?? '0'),
    current_locks: Number(row.current_locks) || 0,
    is_frozen: isFrozen,
    row_style: getRowStyle(isFrozen, row.event_date),
    price_type:
      Number(row.school_one_off_price) > 0 ? 'oneoff' : 'deposit',
  };
}

function formatLongEventDate(value) {
  if (isTbcEventDate(value)) return 'TBC';

  const raw = normalizeSqlDateRaw(value);
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;

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

  return `${weekdays[d.getDay()]} ${dayNum}${suffix} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function sortEventDates(rows) {
  return [...rows].sort((a, b) => {
    const aTbc = Boolean(a.is_tbc ?? isTbcEventDate(a.event_date));
    const bTbc = Boolean(b.is_tbc ?? isTbcEventDate(b.event_date));
    if (aTbc && !bTbc) return 1;
    if (!aTbc && bTbc) return -1;
    return a.event_date.localeCompare(b.event_date);
  });
}

function displayOptionalValue(value) {
  if (value == null || value === '') return '';
  if (Number(value) === 0) return '';
  return String(value);
}

function isOwnVehicleEnabled(value) {
  return value != null && String(value) !== '' && Number(value) !== 0;
}

async function getCourseFilterOptions(pool) {
  const [rows] = await pool.query(
    `SELECT id, course_name
     FROM courses
     WHERE isDeleted = '0' AND status IN ('1', '2')
     ORDER BY course_name ASC`
  );
  return (rows || []).map((row) => ({
    value: String(row.id),
    label: row.course_name,
  }));
}

async function getLocationsByCourse(pool, courseId) {
  const cid = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) return [];

  const [rows] = await pool.query(
    `SELECT * FROM (
      SELECT course_event_dates.event_date,
        course_event_dates.course_event_id,
        locations.location_name,
        locations.id AS location_id
      FROM course_event_dates
      JOIN course_events ON course_events.id = course_event_dates.course_event_id
      JOIN courses ON courses.id = course_events.course_id
      JOIN locations ON locations.id = course_events.location_id
      WHERE course_events.status = '1'
        AND courses.status IN ('1', '2')
        AND course_event_dates.event_date != '0000-00-00'
        AND courses.id = ?
      ORDER BY course_event_dates.course_event_id, course_event_dates.event_date
    ) sq
    GROUP BY sq.course_event_id
    ORDER BY sq.location_name DESC`,
    [cid]
  );

  const seen = new Set();
  const options = [];
  for (const row of rows || []) {
    if (seen.has(row.location_id)) continue;
    seen.add(row.location_id);
    options.push({
      value: String(row.location_id),
      label: row.location_name,
    });
  }
  return options;
}

async function listCourseEvents(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const { where, params } = buildListWhere(searchterm);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const baseSql = `${LIST_SELECT} ${where} ${LIST_GROUP_ORDER}`;
  const [countRows] = await pool.query(baseSql, params);
  const total = (countRows || []).length;

  const [rows] = await pool.query(`${baseSql} LIMIT ?, ?`, [
    ...params,
    offset,
    RECORDS_PER_PAGE,
  ]);

  const sortedRows = [...(rows || [])].sort((a, b) => {
    const dateA = normalizeSqlDate(a.event_date);
    const dateB = normalizeSqlDate(b.event_date);
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return Number(b.course_event_id) - Number(a.course_event_id);
  });

  const eventIds = sortedRows.map((row) => row.course_event_id);
  const frozenMap = await getFrozenMap(pool, eventIds);

  return {
    items: sortedRows.map((row) => mapListRow(row, frozenMap)),
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: {
      name_scr: trim(searchterm.name_scr),
      from_scr: trim(searchterm.from_scr),
      to_scr: trim(searchterm.to_scr),
      loc_scr: trim(searchterm.loc_scr),
      sort: trim(searchterm.sort),
    },
    courseOptions: await getCourseFilterOptions(pool),
    locationOptions: trim(searchterm.name_scr)
      ? await getLocationsByCourse(pool, searchterm.name_scr)
      : [],
  };
}

async function getCourseEventDetail(pool, id) {
  const eventId = Number(id);
  if (!Number.isFinite(eventId) || eventId <= 0) return null;

  const [eventRows] = await pool.query(
    'SELECT * FROM course_events WHERE id = ? LIMIT 1',
    [eventId]
  );
  const event = eventRows?.[0];
  if (!event) return null;

  const [[courseRow]] = await pool.query(
    'SELECT course_name FROM courses WHERE id = ? LIMIT 1',
    [event.course_id]
  );
  const [[locationRow]] = await pool.query(
    'SELECT location_name FROM locations WHERE id = ? LIMIT 1',
    [event.location_id]
  );
  const [[franchiseRow]] = await pool.query(
    'SELECT franchise_name FROM franchise WHERE id = ? LIMIT 1',
    [event.franchise_id]
  );

  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates
     WHERE course_event_id = ?
     ORDER BY event_date ASC`,
    [eventId]
  );

  const eventsDates = sortEventDates(
    (dateRows || []).map((row) => {
      const eventDate = normalizeSqlDateRaw(row.event_date);
      const isTbc = isTbcEventDate(eventDate);
      return {
        event_date: eventDate,
        event_date_label: isTbc ? 'TBC' : formatLongEventDate(eventDate),
        event_start_time: row.event_start_time || '',
        event_end_time: row.event_end_time || '',
        is_tbc: isTbc,
      };
    })
  );

  return {
    id: event.id,
    event_type: event.event_type,
    event_type_label:
      event.event_type === 'single' ? 'Single Day Event' : 'Multi Day Event',
    course_id: event.course_id,
    course_name: courseRow?.course_name || '',
    location_id: event.location_id,
    location_name: locationRow?.location_name || '',
    franchise_id: event.franchise_id,
    franchise_name: franchiseRow?.franchise_name || '',
    booking_limit: event.booking_limit,
    vehicle_type_manual: displayOptionalValue(event.vehicle_type_manual),
    vehicle_type_automatic: displayOptionalValue(event.vehicle_type_automatic),
    vehicle_type_own: event.vehicle_type_own,
    vehicle_type_own_label: isOwnVehicleEnabled(event.vehicle_type_own)
      ? 'ON'
      : 'OFF',
    school_one_off_price: displayOptionalValue(event.school_one_off_price),
    school_deposit_price: displayOptionalValue(event.school_deposit_price),
    school_total_price: displayOptionalValue(event.school_total_price),
    own_one_off_price: displayOptionalValue(event.own_one_off_price),
    own_deposit_price: displayOptionalValue(event.own_deposit_price),
    own_total_price: displayOptionalValue(event.own_total_price),
    is_deposit: event.is_deposit,
    show_own_vehicle_pricing: isOwnVehicleEnabled(event.vehicle_type_own),
    eventsDates,
  };
}

async function getCourseEventBookingCount(pool, id) {
  const eventId = Number(id);
  if (!Number.isFinite(eventId) || eventId <= 0) return 0;

  const [rows] = await pool.query(
    'SELECT id FROM bookings WHERE course_event_id = ? AND status = 1',
    [eventId]
  );
  return (rows || []).length;
}

async function deleteCourseEvent(pool, id, adminId) {
  const eventId = Number(id);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    const err = new Error('Course event not found to delete');
    err.status = 404;
    throw err;
  }

  const [[eventRow]] = await pool.query(
    'SELECT id, current_locks, parent FROM course_events WHERE id = ? LIMIT 1',
    [eventId]
  );
  if (!eventRow) {
    const err = new Error('Course event not found to delete');
    err.status = 404;
    throw err;
  }

  if (Number(eventRow.current_locks) > 0) {
    const err = new Error('processing');
    err.status = 409;
    throw err;
  }

  const connection = await pool.getConnection();
  let hadBookings = false;
  try {
    await connection.beginTransaction();

    const [bookings] = await connection.query(
      `SELECT bookings.id, booking_attendees.vehicle_type
       FROM bookings
       JOIN booking_attendees ON bookings.id = booking_attendees.booking_id
       WHERE bookings.course_event_id = ? AND bookings.status = 1`,
      [eventId]
    );

    if ((bookings || []).length > 0) {
      hadBookings = true;
      let manCount = 0;
      let autoCount = 0;
      const now = formatTimestamp();

      for (const booking of bookings) {
        await connection.query('DELETE FROM bookings WHERE id = ?', [booking.id]);
        await connection.query('DELETE FROM booking_attendees WHERE booking_id = ?', [
          booking.id,
        ]);
        await connection.query(
          `INSERT INTO booking_update_history
           (booking_id, updated_by_admin_id, type, status, created, modified)
           VALUES (?, ?, 'deleted', 'Booking deleted', ?, ?)`,
          [booking.id, adminId || 0, now, now]
        );
        if (Number(booking.vehicle_type) === 1) autoCount += 1;
        else if (Number(booking.vehicle_type) === 0) manCount += 1;
      }

      const allBks = bookings.length;
      await connection.query(
        `UPDATE course_events
         SET bookings_done = bookings_done - ?,
             manual_lock_done = manual_lock_done - ?,
             automatic_lock_done = automatic_lock_done - ?
         WHERE parent = ?`,
        [allBks, manCount, autoCount, eventRow.parent]
      );
    }

    await connection.query('DELETE FROM course_events WHERE id = ?', [eventId]);
    await connection.query(
      'DELETE FROM course_event_dates WHERE course_event_id = ?',
      [eventId]
    );
    await connection.query('DELETE FROM freeze WHERE course_event_id = ?', [
      eventId,
    ]);

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return {
    hadBookings,
    message: hadBookings
      ? 'Course delete with all the bookings successfully.'
      : 'Course deleted successfully.',
  };
}

async function bulkDeleteCourseEvents(pool, items, adminId) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('No Course Selected');
    err.status = 400;
    throw err;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const now = formatTimestamp();

    for (const item of items) {
      const courseId = Number(item.course_id);
      const courseEventId = Number(item.course_event_id);
      const eventDate = trim(item.selected_date);
      if (
        !Number.isFinite(courseId) ||
        !Number.isFinite(courseEventId) ||
        !eventDate
      ) {
        continue;
      }

      await connection.query(
        'DELETE FROM course_event_dates WHERE course_event_id = ? AND event_date = ?',
        [courseEventId, eventDate]
      );

      const [remainingDates] = await connection.query(
        'SELECT id FROM course_event_dates WHERE course_event_id = ? LIMIT 1',
        [courseEventId]
      );

      const [bookings] = await connection.query(
        'SELECT id FROM bookings WHERE course_event_id = ? AND course_id = ?',
        [courseEventId, courseId]
      );

      for (const booking of bookings || []) {
        await connection.query('DELETE FROM bookings WHERE id = ?', [booking.id]);
        await connection.query('DELETE FROM booking_attendees WHERE booking_id = ?', [
          booking.id,
        ]);
        await connection.query(
          `INSERT INTO booking_update_history
           (booking_id, updated_by_admin_id, type, status, created, modified)
           VALUES (?, ?, 'deleted', 'Booking deleted', ?, ?)`,
          [booking.id, adminId || 0, now, now]
        );
      }

      if (!(remainingDates || []).length) {
        await connection.query(
          'DELETE FROM course_events WHERE course_id = ? AND id = ?',
          [courseId, courseEventId]
        );
        await connection.query('DELETE FROM freeze WHERE course_event_id = ?', [
          courseEventId,
        ]);
      }
    }

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return { message: 'Course Found' };
}

module.exports = {
  RECORDS_PER_PAGE,
  TBC_EVENT_DATE,
  normalizeSqlDateRaw,
  listCourseEvents,
  getCourseFilterOptions,
  getLocationsByCourse,
  getCourseEventDetail,
  getCourseEventBookingCount,
  deleteCourseEvent,
  bulkDeleteCourseEvents,
};
