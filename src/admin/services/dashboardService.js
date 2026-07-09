function formatDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
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

function isTbcDate(value) {
  if (value == null || String(value).trim() === '') {
    return true;
  }

  const raw = String(value).trim().slice(0, 10);
  if (raw === '0000-00-00' || raw === '1111-11-11') {
    return true;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }

  return parsed.getFullYear() < 1900;
}

function filterConfirmedDates(dates) {
  return [...dates]
    .filter((date) => !isTbcDate(date))
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function getPrimaryEventDate(dates, fallback) {
  const confirmed = filterConfirmedDates(dates);
  if (confirmed.length) {
    return confirmed[0];
  }
  if (fallback && !isTbcDate(fallback)) {
    return formatDateValue(fallback);
  }
  return null;
}

const CONFIRMED_DATE_SQL = `
  course_event_dates.event_date != '0000-00-00'
  AND course_event_dates.event_date != '1111-11-11'
  AND YEAR(course_event_dates.event_date) >= 1900
`;

function buildSearchWhere(searchterm) {
  let where =
    ` WHERE course_events.status = '1' AND courses.status IN ('1', '2') AND ${CONFIRMED_DATE_SQL} `;
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
  const [allDateRows] = await pool.query(
    `SELECT course_event_id, event_date
     FROM course_event_dates
     WHERE course_event_id IN (?)`,
    [eventIds]
  );

  const dayCountByEvent = {};
  for (const row of allDateRows) {
    const id = row.course_event_id;
    dayCountByEvent[id] = (dayCountByEvent[id] || 0) + 1;
  }

  const [dateRows] = await pool.query(
    `SELECT course_event_id, event_date
     FROM course_event_dates
     WHERE course_event_id IN (?)
       AND ${CONFIRMED_DATE_SQL}`,
    [eventIds]
  );

  const datesByEvent = {};
  for (const row of dateRows) {
    const id = row.course_event_id;
    if (!datesByEvent[id]) {
      datesByEvent[id] = [];
    }
    const formatted = formatDateValue(row.event_date);
    if (formatted && !isTbcDate(formatted) && !datesByEvent[id].includes(formatted)) {
      datesByEvent[id].push(formatted);
    }
  }

  for (const id of Object.keys(datesByEvent)) {
    datesByEvent[id] = filterConfirmedDates(datesByEvent[id]);
  }

  const frozenIds = await getFrozenEventIds(pool, eventIds);

  return rows.map((row) => {
    const rawDates = datesByEvent[row.course_event_id] || [];
    const fallbackDate = formatDateValue(row.event_date);
    const eventDates =
      rawDates.length > 0
        ? rawDates
        : fallbackDate && !isTbcDate(fallbackDate)
          ? [fallbackDate]
          : [];
    const primaryDate = getPrimaryEventDate(eventDates, fallbackDate);

    return {
      course_event_id: row.course_event_id,
      course_name: row.course_name,
      course_id: row.course_id,
      event_date: primaryDate,
      event_type: row.event_type,
      loc_abb: row.loc_abb,
      event_start_time: formatTimeValue(row.event_start_time),
      event_end_time: formatTimeValue(row.event_end_time),
      booking_limit: Number(row.booking_limit) || 0,
      bookings_done: Number(row.bookings_done) || 0,
      current_locks: Number(row.current_locks) || 0,
      eventDates,
      eventDayCount: dayCountByEvent[row.course_event_id] || eventDates.length,
      isFrozen: frozenIds.has(row.course_event_id),
    };
  }).filter((row) => row.event_date != null);
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
    AND ${CONFIRMED_DATE_SQL}
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
    ` WHERE course_events.status = '1' AND courses.status IN ('1', '2') AND ${CONFIRMED_DATE_SQL} `;

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
    return `<a href="/admin/coming-soon?feature=F-020" style="color:red;">Bookings Currently In Progress: ${total}</a>`;
  }
  return 'Bookings Currently In Progress: 0';
}

function pad2Local(n) {
  return String(n).padStart(2, '0');
}

function toIsoDateValue(date) {
  return `${date.getFullYear()}-${pad2Local(date.getMonth() + 1)}-${pad2Local(date.getDate())}`;
}

function parseIsoDateValue(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function mondayOfWeek(iso) {
  const date = parseIsoDateValue(iso);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - (day - 1));
  return toIsoDateValue(date);
}

function addDaysIso(iso, days) {
  const date = parseIsoDateValue(iso);
  date.setDate(date.getDate() + days);
  return toIsoDateValue(date);
}

function getEventDatesForAvail(avail) {
  if (Array.isArray(avail.eventDates) && avail.eventDates.length) {
    return filterConfirmedDates(avail.eventDates);
  }
  const fallback = avail.event_date ? formatDateValue(avail.event_date) : null;
  return fallback && !isTbcDate(fallback) ? [fallback] : [];
}

function getCalendarDatesForAvail(avail) {
  const confirmed = getEventDatesForAvail(avail);
  if (!confirmed.length) {
    return [];
  }
  if (avail.event_type === 'multi') {
    return [confirmed[0]];
  }
  return confirmed;
}

/**
 * Week summary for dashboard v2 — one session per event in the week.
 */
function computeWeekSummary(courseAvails, anchorIso) {
  const weekStart = mondayOfWeek(anchorIso);
  const weekEnd = addDaysIso(weekStart, 6);

  let sessionCount = 0;
  let spacesLeft = 0;
  let coursesFull = 0;

  for (const avail of courseAvails || []) {
    const capacity = Number(avail.booking_limit) || 0;
    const booked =
      Number(avail.bookings_done || 0) + Number(avail.current_locks || 0);
    const spaces = avail.isFrozen ? 0 : Math.max(0, capacity - booked);

    const displayDates = getCalendarDatesForAvail(avail);
    const appearsInWeek = displayDates.some(
      (dateStr) => dateStr >= weekStart && dateStr <= weekEnd
    );

    if (!appearsInWeek) {
      continue;
    }

    sessionCount += 1;
    if (avail.isFrozen || spaces === 0) {
      coursesFull += 1;
    } else {
      spacesLeft += spaces;
    }
  }

  return {
    sessionCount,
    spacesLeft,
    coursesFull,
    weekStart,
    weekEnd,
  };
}

function parseViewParams(query) {
  const view = query.view === 'month' ? 'month' : 'week';
  const anchorRaw =
    query.anchor != null ? String(query.anchor).trim() : '';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(anchorRaw)
    ? anchorRaw
    : new Date().toISOString().slice(0, 10);

  return { view, anchor };
}

module.exports = {
  courseAvailsDashboard,
  selectFutureCourses,
  selectLocations,
  expirePromos,
  getCurrentLocksTotal,
  buildCurrentLockCountHtml,
  formatDateValue,
  computeWeekSummary,
  parseViewParams,
  isTbcDate,
  filterConfirmedDates,
};
