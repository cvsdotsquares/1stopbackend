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

/** Index-friendly stand-in for YEAR(event_date) >= 1900 / != 0000-00-00. */
const CONFIRMED_DATE_SQL = `course_event_dates.event_date > '1900-01-01'`;

function padIso(n) {
  return String(n).padStart(2, '0');
}

function toIsoLocal(date) {
  return `${date.getFullYear()}-${padIso(date.getMonth() + 1)}-${padIso(date.getDate())}`;
}

function parseIsoLocal(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayIso() {
  return toIsoLocal(new Date());
}

function weekRange(anchorIso) {
  const date = parseIsoLocal(anchorIso);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - (day - 1));
  const start = toIsoLocal(date);
  date.setDate(date.getDate() + 6);
  return { start, end: toIsoLocal(date) };
}

function monthGridRange(anchorIso) {
  const date = parseIsoLocal(anchorIso);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const startOffset = (first.getDay() || 7) - 1;
  const gridStart = new Date(date.getFullYear(), date.getMonth(), 1 - startOffset);
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 41);
  return { start: toIsoLocal(gridStart), end: toIsoLocal(gridEnd) };
}

function calendarMonthRange(anchorIso) {
  const date = parseIsoLocal(anchorIso);
  const start = toIsoLocal(new Date(date.getFullYear(), date.getMonth(), 1));
  const end = toIsoLocal(new Date(date.getFullYear(), date.getMonth() + 1, 0));
  return { start, end };
}

function upcomingWindow() {
  const now = new Date();
  return {
    start: toIsoLocal(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: toIsoLocal(new Date(now.getFullYear() + 2, now.getMonth(), 0)),
  };
}

function mergeRanges(ranges) {
  const starts = ranges.map((r) => r.start).sort();
  const ends = ranges.map((r) => r.end).sort();
  return { start: starts[0], end: ends[ends.length - 1] };
}

/**
 * Dashboard v2 only paints the visible week/month (+ current month analytics).
 * Change-date modal sends crs_scr with no view/anchor and needs upcoming events.
 */
function resolveAvailWindow(query = {}) {
  const crsScr = query.crs_scr != null && String(query.crs_scr).trim() !== '';
  const hasView = query.view != null && String(query.view).trim() !== '';
  const hasAnchor = query.anchor != null && String(query.anchor).trim() !== '';
  const hasDate =
    query.date != null && String(query.date).trim() !== '';

  if (crsScr && !hasView && !hasAnchor && !hasDate) {
    return upcomingWindow();
  }

  const today = todayIso();
  const ranges = [calendarMonthRange(today)];

  if (hasView || hasAnchor) {
    const view = String(query.view) === 'month' ? 'month' : 'week';
    const anchor =
      /^\d{4}-\d{2}-\d{2}$/.test(String(query.anchor || ''))
        ? String(query.anchor)
        : today;
    ranges.push(view === 'month' ? monthGridRange(anchor) : weekRange(anchor));
  } else if (hasDate) {
    const month = String(query.date).padStart(2, '0');
    const year = query.year ? String(query.year) : String(new Date().getFullYear());
    ranges.push(monthGridRange(`${year}-${month}-01`));
  } else {
    ranges.push(weekRange(today));
  }

  return mergeRanges(ranges);
}

function buildSearchWhere(searchterm, dateWindow) {
  const params = [];
  let where = ` WHERE course_events.status = '1'
    AND courses.status IN ('1', '2')
    AND EXISTS (
      SELECT 1 FROM course_event_dates ced
      WHERE ced.course_event_id = course_events.id
        AND ced.event_date >= ?
        AND ced.event_date <= ?
    ) `;
  params.push(dateWindow.start, dateWindow.end);

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
 * Windowed to the visible calendar so we don't hydrate ~20k historical events.
 */
async function courseAvailsDashboard(pool, searchterm, query = {}) {
  const dateWindow = resolveAvailWindow(query);
  const { where, params } = buildSearchWhere(searchterm, dateWindow);

  const sql = `SELECT
      course_events.id AS course_event_id,
      course_events.event_type,
      course_events.booking_limit,
      course_events.bookings_done,
      course_events.current_locks,
      courses.course_name,
      courses.id AS course_id,
      locations.id AS location_id,
      locations.location_name,
      locations.loc_abb,
      locations.dashboard_color
    FROM course_events
    INNER JOIN courses ON courses.id = course_events.course_id
    LEFT JOIN locations ON locations.id = course_events.location_id
    ${where}
    ORDER BY courses.course_name ASC, locations.loc_abb ASC`;

  const [rows] = await pool.query(sql, params);
  return enrichCourseAvails(pool, rows || []);
}

async function enrichCourseAvails(pool, rows) {
  if (!rows.length) {
    return [];
  }

  const eventIds = rows.map((r) => r.course_event_id);
  const [dateRows, frozenIds] = await Promise.all([
    pool
      .query(
        `SELECT course_event_id, event_date, event_start_time, event_end_time
         FROM course_event_dates
         WHERE course_event_id IN (?)`,
        [eventIds]
      )
      .then(([result]) => result || []),
    getFrozenEventIds(pool, eventIds),
  ]);

  const dayCountByEvent = {};
  const datesByEvent = {};
  const timeByEvent = {};

  for (const row of dateRows) {
    const id = row.course_event_id;
    dayCountByEvent[id] = (dayCountByEvent[id] || 0) + 1;

    const formatted = formatDateValue(row.event_date);
    if (!formatted || isTbcDate(formatted)) {
      continue;
    }
    if (!datesByEvent[id]) {
      datesByEvent[id] = [];
    }
    if (!datesByEvent[id].includes(formatted)) {
      datesByEvent[id].push(formatted);
    }
    if (!timeByEvent[id] || formatted < timeByEvent[id].date) {
      timeByEvent[id] = {
        date: formatted,
        start: row.event_start_time,
        end: row.event_end_time,
      };
    }
  }

  for (const id of Object.keys(datesByEvent)) {
    datesByEvent[id] = filterConfirmedDates(datesByEvent[id]);
  }

  return rows
    .map((row) => {
      const eventDates = datesByEvent[row.course_event_id] || [];
      const primaryDate = getPrimaryEventDate(eventDates, null);
      const times = timeByEvent[row.course_event_id] || {};

      return {
        course_event_id: row.course_event_id,
        course_name: row.course_name,
        course_id: row.course_id,
        event_date: primaryDate,
        event_type: row.event_type,
        location_id: Number(row.location_id) || 0,
        location_name: row.location_name || '',
        loc_abb: row.loc_abb,
        dashboard_color: row.dashboard_color || '#94a3b8',
        event_start_time: formatTimeValue(times.start || row.event_start_time),
        event_end_time: formatTimeValue(times.end || row.event_end_time),
        booking_limit: Number(row.booking_limit) || 0,
        bookings_done: Number(row.bookings_done) || 0,
        current_locks: Number(row.current_locks) || 0,
        eventDates,
        eventDayCount: dayCountByEvent[row.course_event_id] || eventDates.length,
        isFrozen: frozenIds.has(row.course_event_id),
      };
    })
    .filter((row) => row.event_date != null);
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
 * Unique courses with a confirmed date from the start of this month onward.
 */
async function selectFutureCourses(pool) {
  const monthStart = toIsoLocal(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  const [rows] = await pool.query(
    `SELECT DISTINCT courses.id AS course_id, courses.course_name
     FROM courses
     INNER JOIN course_events ON course_events.course_id = courses.id
       AND course_events.status = '1'
     INNER JOIN course_event_dates ON course_event_dates.course_event_id = course_events.id
       AND course_event_dates.event_date >= ?
     WHERE courses.status IN ('1', '2')
     ORDER BY courses.course_name ASC`,
    [monthStart]
  );

  return (rows || []).map((row) => ({
    course_id: row.course_id,
    course_name: row.course_name,
    course_event_id: 0,
  }));
}

/**
 * Port of Dashboard::selectLocations()
 */
async function selectLocations(pool) {
  const [rows] = await pool.query(
    `SELECT DISTINCT locations.id AS location_id, locations.location_name
     FROM locations
     INNER JOIN course_events ON course_events.location_id = locations.id
       AND course_events.status = '1'
     INNER JOIN courses ON courses.id = course_events.course_id
       AND courses.status IN ('1', '2')
     INNER JOIN course_event_dates ON course_event_dates.course_event_id = course_events.id
       AND ${CONFIRMED_DATE_SQL}
     ORDER BY locations.location_name DESC`
  );
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
