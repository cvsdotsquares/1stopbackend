const RECORDS_PER_PAGE = 40;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function formatDateValue(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  return str;
}

function formatTimeValue(value) {
  if (!value) return '';
  const str = String(value);
  if (/^\d{2}:\d{2}:\d{2}$/.test(str)) {
    return str.slice(0, 5);
  }
  return str;
}

function formatDisplayDate(dateStr) {
  const normalized = formatDateValue(dateStr);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  if (!year || !month || !day) return normalized;
  return `${String(day).padStart(2, '0')}-${MONTHS[month - 1]}-${year}`;
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildListWhere(searchterm) {
  let where = ' WHERE 1=1 ';
  const params = [];
  let searchParam = false;

  const courseId = trim(searchterm?.name_scr);
  if (courseId) {
    where += ' AND courses.id = ?';
    params.push(Number(courseId));
  }

  const fromScr = trim(searchterm?.from_scr);
  const toScr = trim(searchterm?.to_scr);

  if (fromScr && toScr) {
    where += ' AND course_event_dates.event_date >= ? AND course_event_dates.event_date <= ?';
    params.push(fromScr, toScr);
    searchParam = true;
  } else if (fromScr) {
    where += ' AND course_event_dates.event_date >= ?';
    params.push(fromScr);
    searchParam = true;
  } else if (toScr) {
    where += ' AND course_event_dates.event_date <= ?';
    params.push(toScr);
    searchParam = true;
  }

  const locId = trim(searchterm?.loc_scr);
  if (locId) {
    where += ' AND course_events.location_id = ?';
    params.push(Number(locId));
  }

  if (!searchParam) {
    where += ' AND course_event_dates.event_date >= CURDATE()';
  }

  return { where, params };
}

const LIST_FROM = `
  FROM course_events
  JOIN locations ON course_events.location_id = locations.id
  JOIN courses ON courses.id = course_events.course_id
  JOIN course_event_dates ON course_events.id = course_event_dates.course_event_id
`;

const LIST_SELECT = `
  SELECT
    MIN(course_events.id) AS id,
    MIN(courses.id) AS cid,
    MIN(course_events.id) AS course_event_id,
    MIN(course_events.school_one_off_price) AS school_one_off_price,
    MIN(course_events.school_deposit_price) AS school_deposit_price,
    MIN(course_events.school_total_price) AS school_total_price,
    MIN(course_events.status) AS status,
    MIN(course_events.event_type) AS event_type,
    MIN(course_events.created) AS created,
    MIN(courses.course_name) AS course_name,
    MIN(course_event_dates.id) AS dateid,
    MIN(course_event_dates.event_start_time) AS event_start_time,
    MIN(course_event_dates.event_end_time) AS event_end_time,
    MIN(locations.id) AS locationId,
    MIN(locations.location_name) AS location_name,
    MIN(course_events.booking_limit) AS booking_limit,
    MIN(course_event_dates.event_date) AS event_date,
    MIN(course_events.bookings_done) AS bookings_done,
    MIN(course_events.parent) AS parent,
    MIN(course_events.current_locks) AS current_locks
`;

const LIST_GROUP_ORDER =
  ' GROUP BY course_events.course_id, course_events.parent ORDER BY course_event_dates.event_date ASC, course_events.id DESC ';

function sortPageByEventDate(rows) {
  return [...rows].sort((a, b) => {
    const left = formatDateValue(a.event_date);
    const right = formatDateValue(b.event_date);
    if (left === right) {
      return Number(b.id) - Number(a.id);
    }
    return left.localeCompare(right);
  });
}

function mapPriceDisplay(row) {
  const oneOff = Number(row.school_one_off_price) || 0;
  const deposit = Number(row.school_deposit_price) || 0;
  if (oneOff > 0) {
    return String(oneOff);
  }
  if (deposit > 0) {
    return String(row.school_total_price ?? '');
  }
  return '';
}

function mapPriceType(row) {
  return Number(row.school_one_off_price) > 0 ? 'oneoff' : 'deposit';
}

async function getFrozenMap(pool, eventIds) {
  if (!eventIds.length) {
    return new Map();
  }

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
  const eventDate = formatDateValue(row.event_date);
  const frozen = frozenMap.get(row.id);
  const bookingsDone = frozen
    ? Number(frozen.bookings_done) || 0
    : Number(row.bookings_done) || 0;

  const dateObj = eventDate
    ? (() => {
        const [year, month, day] = eventDate.split('-').map(Number);
        if (!year || !month || !day) return null;
        return new Date(year, month - 1, day);
      })()
    : null;
  const weekday = dateObj ? dateObj.getDay() : null;
  const isWeekend = weekday === 0 || weekday === 6;

  let rowBackground = null;
  if (frozen && isWeekend) {
    rowBackground = '#ecddab';
  } else if (frozen) {
    rowBackground = '#ecafab';
  } else if (isWeekend) {
    rowBackground = '#cccccc';
  }

  return {
    id: row.id,
    dateid: row.dateid,
    rowKey: String(row.id),
    course_id: row.cid,
    course_name: row.course_name,
    location_id: row.locationId,
    location_name: row.location_name,
    event_date: eventDate,
    event_date_display: formatDisplayDate(eventDate),
    event_start_time: formatTimeValue(row.event_start_time),
    event_end_time: formatTimeValue(row.event_end_time),
    event_time_display: `${formatTimeValue(row.event_start_time)} - ${formatTimeValue(row.event_end_time)}`,
    price_display: mapPriceDisplay(row),
    price_type: mapPriceType(row),
    school_one_off_price: row.school_one_off_price,
    school_deposit_price: row.school_deposit_price,
    school_total_price: row.school_total_price,
    bookings_done: bookingsDone,
    bookings_done_display: String(bookingsDone).toUpperCase(),
    booking_limit: Number(row.booking_limit) || 0,
    booking_limit_display: String(row.booking_limit ?? '').toUpperCase(),
    event_type: row.event_type,
    status: String(row.status ?? '0'),
    parent: row.parent,
    current_locks: Number(row.current_locks) || 0,
    isFrozen: Boolean(frozen),
    isWeekend,
    rowBackground,
  };
}

async function listCourseEvents(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const { where, params } = buildListWhere(searchterm);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  // Legacy Zebra pagination counts ungrouped join rows (one per event date line).
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     ${LIST_FROM}
     ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `${LIST_SELECT}
     ${LIST_FROM}
     ${where}
     ${LIST_GROUP_ORDER}
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  const pageRows = sortPageByEventDate(rows || []);
  const eventIds = pageRows.map((row) => row.id);
  const frozenMap = await getFrozenMap(pool, eventIds);

  return {
    items: pageRows.map((row) => mapListRow(row, frozenMap)),
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: {
      from_scr: trim(searchterm?.from_scr),
      to_scr: trim(searchterm?.to_scr),
      name_scr: trim(searchterm?.name_scr),
      loc_scr: trim(searchterm?.loc_scr),
      sort: trim(searchterm?.sort),
    },
  };
}

async function courseEventExists(pool, id) {
  const [rows] = await pool.query('SELECT id FROM course_events WHERE id = ? LIMIT 1', [
    id,
  ]);
  return Boolean(rows?.length);
}

async function updateCourseEventStatus(pool, id, status) {
  const exists = await courseEventExists(pool, id);
  if (!exists) {
    return { ok: false, message: 'Course event not found to delete' };
  }

  const [result] = await pool.query(
    'UPDATE course_events SET status = ? WHERE id = ?',
    [status, id]
  );

  if (result.affectedRows > 0) {
    return { ok: true, message: 'Course event status changed successfully' };
  }

  return { ok: false, message: 'Error in change status' };
}

async function getBookingCount(pool, id) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS total FROM bookings WHERE course_event_id = ? AND status = 1',
    [id]
  );
  return Number(rows?.[0]?.total) || 0;
}

async function deleteCourseEvent(pool, id, adminId) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [eventRows] = await connection.query(
      'SELECT * FROM course_events WHERE id = ? LIMIT 1',
      [id]
    );

    if (!eventRows?.length) {
      await connection.rollback();
      return { ok: false, message: 'Course event not found' };
    }

    const eventRow = eventRows[0];

    if (Number(eventRow.current_locks) > 0) {
      await connection.rollback();
      return {
        ok: false,
        code: 'processing',
        message: 'There is some booking in progress, course can not be deleted',
      };
    }

    const [bookings] = await connection.query(
      `SELECT bookings.id, bookings.vehicle_type
       FROM bookings
       JOIN booking_attendees ON bookings.id = booking_attendees.booking_id
       WHERE bookings.course_event_id = ? AND bookings.status = 1`,
      [id]
    );

    let message = 'Course deleted successfully.';
    const now = formatTimestamp();

    if (bookings?.length) {
      let manualCount = 0;
      let automaticCount = 0;

      for (const booking of bookings) {
        await connection.query('DELETE FROM bookings WHERE id = ?', [booking.id]);
        await connection.query('DELETE FROM booking_attendees WHERE booking_id = ?', [
          booking.id,
        ]);
        await connection.query(
          `INSERT INTO booking_update_history
            (booking_id, updated_by_admin_id, type, status, created, modified)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [booking.id, adminId, 'deleted', 'Booking deleted', now, now]
        );

        if (Number(booking.vehicle_type) === 1) {
          automaticCount += 1;
        } else if (Number(booking.vehicle_type) === 0) {
          manualCount += 1;
        }
      }

      const totalBookings = bookings.length;
      await connection.query(
        `UPDATE course_events
         SET bookings_done = bookings_done - ?,
             manual_lock_done = manual_lock_done - ?,
             automatic_lock_done = automatic_lock_done - ?
         WHERE parent = ?`,
        [totalBookings, manualCount, automaticCount, eventRow.parent]
      );

      message = 'Course delete with all the bookings successfully.';
    }

    await connection.query('DELETE FROM course_events WHERE id = ?', [id]);
    await connection.query('DELETE FROM course_event_dates WHERE course_event_id = ?', [
      id,
    ]);

    await connection.commit();
    return { ok: true, message, code: 'done' };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function getCourseFilterOptions(pool) {
  const [rows] = await pool.query(
    `SELECT id, course_name
     FROM courses
     WHERE isDeleted = '0' AND (status = '1' OR status = '2')
     ORDER BY course_name ASC`
  );

  return (rows || []).map((row) => ({
    id: row.id,
    course_name: row.course_name,
  }));
}

async function getLocationFilterOptions(pool, courseId) {
  const id = Number(courseId);
  if (!Number.isFinite(id) || id <= 0) {
    return [];
  }

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
    GROUP BY sq.location_id
    ORDER BY sq.location_name DESC`,
    [id]
  );

  const byId = new Map();
  for (const row of rows || []) {
    byId.set(row.location_id, {
      id: row.location_id,
      location_name: row.location_name,
    });
  }

  return [...byId.values()];
}

module.exports = {
  listCourseEvents,
  updateCourseEventStatus,
  getBookingCount,
  deleteCourseEvent,
  getCourseFilterOptions,
  getLocationFilterOptions,
};
