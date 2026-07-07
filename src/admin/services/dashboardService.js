function formatDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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

function buildSearchWhere(searchterm) {
  let where =
    " WHERE course_events.status = '1' AND courses.status IN ('1', '2') AND course_event_dates.event_date != '0000-00-00' ";
  const params = [];

  if (searchterm[0] != null && String(searchterm[0]).trim() !== '') {
    where += ' AND courses.id = ?';
    params.push(searchterm[0]);
  }
  if (searchterm[1] != null && String(searchterm[1]).trim() !== '') {
    where += ' AND locations.id = ?';
    params.push(searchterm[1]);
  }

  return { where, params };
}

/**
 * Port of Dashboard::course_avails_dashboard($searchterm)
 */
async function courseAvailsDashboard(pool, searchterm) {
  const { where, params } = buildSearchWhere(searchterm);

  const sql = `SELECT * FROM (
    SELECT course_event_dates.course_event_id,
      MIN(course_event_dates.event_date) AS event_date,
      course_event_dates.event_start_time,
      course_event_dates.event_end_time,
      course_events.event_type,
      course_events.booking_limit,
      course_events.bookings_done,
      course_events.current_locks,
      courses.course_name,
      courses.id AS course_id,
      locations.loc_abb,
      STR_TO_DATE(
        CONCAT(
          DATE_FORMAT(event_date, '%Y-%m-%d'),
          ' ',
          TIME_FORMAT(event_start_time, '%H:%i:%s')
        ),
        '%Y-%m-%d %H:%i:%s'
      ) AS ttt
    FROM course_event_dates
    LEFT JOIN course_events ON course_events.id = course_event_dates.course_event_id
    LEFT JOIN courses ON courses.id = course_events.course_id
    LEFT JOIN locations ON locations.id = course_events.location_id
    ${where}
    GROUP BY course_event_id
  ) sq
  GROUP BY sq.course_event_id
  ORDER BY STR_TO_DATE(
    CONCAT(
      DATE_FORMAT(event_date, '%Y-%m-%d'),
      ' ',
      TIME_FORMAT(event_start_time, '%H:%i:%s')
    ),
    '%Y-%m-%d %H:%i:%s'
  ), course_name ASC, loc_abb ASC`;

  const [rows] = await pool.query(sql, params);
  return enrichCourseAvails(pool, rows || []);
}

async function enrichCourseAvails(pool, rows) {
  if (!rows.length) {
    return [];
  }

  const eventIds = rows.map((r) => r.course_event_id);
  const [dateRows] = await pool.query(
    `SELECT course_event_id, event_date
     FROM course_event_dates
     WHERE course_event_id IN (?) AND event_date != '0000-00-00'`,
    [eventIds]
  );

  const datesByEvent = {};
  for (const row of dateRows) {
    const id = row.course_event_id;
    if (!datesByEvent[id]) {
      datesByEvent[id] = [];
    }
    const formatted = formatDateValue(row.event_date);
    if (formatted && !datesByEvent[id].includes(formatted)) {
      datesByEvent[id].push(formatted);
    }
  }

  const frozenIds = await getFrozenEventIds(pool, eventIds);

  return rows.map((row) => {
    const eventDates = datesByEvent[row.course_event_id] || [
      formatDateValue(row.event_date),
    ];
    return {
      course_event_id: row.course_event_id,
      course_name: row.course_name,
      course_id: row.course_id,
      event_date: formatDateValue(row.event_date),
      event_type: row.event_type,
      loc_abb: row.loc_abb,
      event_start_time: formatTimeValue(row.event_start_time),
      event_end_time: formatTimeValue(row.event_end_time),
      booking_limit: Number(row.booking_limit) || 0,
      bookings_done: Number(row.bookings_done) || 0,
      current_locks: Number(row.current_locks) || 0,
      eventDates,
      isFrozen: frozenIds.has(row.course_event_id),
    };
  });
}

async function getFrozenEventIds(pool, eventIds) {
  if (!eventIds.length) {
    return new Set();
  }
  const [rows] = await pool.query(
    'SELECT course_event_id FROM freeze WHERE course_event_id IN (?)',
    [eventIds]
  );
  return new Set((rows || []).map((r) => r.course_event_id));
}

/**
 * Port of Dashboard::selectFutureCourses()
 */
async function selectFutureCourses(pool) {
  const now = new Date().toISOString().slice(0, 10);
  const where = ` WHERE course_events.status = '1' AND courses.status IN ('1', '2')
    AND course_event_dates.event_date != '0000-00-00'
    AND (
      course_event_dates.event_date >= ?
      OR (
        YEAR(course_event_dates.event_date) = YEAR(CURRENT_DATE())
        AND MONTH(course_event_dates.event_date) = MONTH(CURRENT_DATE())
      )
    ) `;

  const sql = `SELECT * FROM (
    SELECT course_event_dates.course_event_id,
      course_event_dates.event_date,
      courses.course_name,
      courses.id AS course_id,
      locations.location_name,
      locations.id AS location_id
    FROM course_event_dates
    JOIN course_events ON course_events.id = course_event_dates.course_event_id
    JOIN courses ON courses.id = course_events.course_id
    JOIN locations ON locations.id = course_events.location_id
    ${where}
    ORDER BY course_event_dates.course_event_id, course_event_dates.event_date
  ) sq
  GROUP BY sq.course_event_id
  ORDER BY sq.course_name ASC`;

  const [rows] = await pool.query(sql, [now]);
  return rows || [];
}

/**
 * Port of Dashboard::selectLocations()
 */
async function selectLocations(pool) {
  const where =
    " WHERE course_events.status = '1' AND courses.status IN ('1', '2') AND course_event_dates.event_date != '0000-00-00' ";

  const sql = `SELECT * FROM (
    SELECT course_event_dates.event_date,
      course_event_dates.course_event_id,
      locations.location_name,
      locations.id AS location_id
    FROM course_event_dates
    JOIN course_events ON course_events.id = course_event_dates.course_event_id
    JOIN courses ON courses.id = course_events.course_id
    JOIN locations ON locations.id = course_events.location_id
    ${where}
    ORDER BY course_event_dates.course_event_id, course_event_dates.event_date
  ) sq
  GROUP BY sq.location_id
  ORDER BY sq.location_name DESC`;

  const [rows] = await pool.query(sql);
  return rows || [];
}

async function expirePromos(pool) {
  const today = new Date().toISOString().slice(0, 10);
  await pool.query(
    'UPDATE promos SET status = 0 WHERE p_c_expiry = 1 AND p_c_expiry_date < ?',
    [today]
  );
}

async function getCurrentLocksTotal(pool) {
  const [rows] = await pool.query(
    'SELECT SUM(current_locks) AS total FROM course_events WHERE current_locks > 0'
  );
  const total = rows?.[0]?.total;
  return total != null ? Number(total) : 0;
}

function buildCurrentLockCountHtml(total) {
  if (total > 0) {
    return `<a href="/admin/bookings/in-progress" style="color:red;">Bookings Currently In Progress: ${total}</a>`;
  }
  return 'Bookings Currently In Progress: 0';
}

module.exports = {
  courseAvailsDashboard,
  selectFutureCourses,
  selectLocations,
  expirePromos,
  getCurrentLocksTotal,
  buildCurrentLockCountHtml,
  formatDateValue,
};
