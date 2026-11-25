/**
 * Home dashboard Alerts widget (global; not filtered by crs_scr / loc_scr).
 */
const {
  ensureEnglandBankHolidaysLoaded,
  isEnglandBankHoliday,
} = require('../../utils/ukEnglandBankHolidays');
const { getGroupAvailability } = require('../../utils/courseEventGroup');

/**
 * Tests-to-cancel alert courses (cancel window: 3 days motorcycle, 4 days module).
 * Sundays / England bank holidays in the range add one extra day each (GOV.UK).
 * Match on course_abb and/or course_name (see testsToCancelCourseProfile).
 */
const MOTORCYCLE_3_DAY_ABBREVS = new Set([
  '3 day a1',
  '3 day a2',
  '3 day das',
]);

const MOTORCYCLE_3_DAY_COURSE_NAMES = new Set([
  'a1 motorcycle licence - 11kw/14.6bhp (cat a1 - 3 days)',
  'a2 motorcycle licence - 35kw/46.6bhp (cat a2 - 3 days)',
  'das - unrestricted motorcycle licence (cat a - 3 days)',
]);

const MODULE_TEST_4_DAY_ABBREVS = new Set([
  'module 1 test day',
  'mod 1 resit',
  'mod 1 test day',
  'mod 1',
  'module 2 test day',
  'mod 2 test day',
  'mod 2',
]);

const MODULE_TEST_4_DAY_COURSE_NAMES = new Set([
  'module 1 test day',
  'module 2 test day',
  'module 1 test day (4 days)',
  'module 2 test day (4 days)',
]);

function normalizeAbb(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Strip trailing “(N Days)” so module titles match with or without the suffix. */
function normalizeCourseNameForMatch(value) {
  const base = normalizeAbb(value);
  return base.replace(/\s*\(\d+\s*days?\)\s*$/i, '').trim();
}

function isMotorcycle3DayTestsToCancelCourse(courseAbb, courseName) {
  const abb = normalizeAbb(courseAbb);
  const name = normalizeCourseNameForMatch(courseName);
  if (MOTORCYCLE_3_DAY_ABBREVS.has(abb)) return true;
  if (MOTORCYCLE_3_DAY_COURSE_NAMES.has(name)) return true;
  if (/^3\s*day\s*(a1|a2|das)\b/.test(abb)) return true;
  if (name.includes('(cat a1 - 3 days)')) return true;
  if (name.includes('(cat a2 - 3 days)')) return true;
  if (name.includes('(cat a - 3 days)') && name.includes('das')) return true;
  return false;
}

function isModuleTest4DayTestsToCancelCourse(courseAbb, courseName) {
  const abb = normalizeAbb(courseAbb);
  const name = normalizeCourseNameForMatch(courseName);
  if (MODULE_TEST_4_DAY_ABBREVS.has(abb)) return true;
  if (MODULE_TEST_4_DAY_COURSE_NAMES.has(name)) return true;
  if (/^mod\s*[12]\b/.test(abb)) return true;
  if (/^mod\s*[12]\s+/.test(abb)) return true;
  if (/^module\s*[12]\s+test\b/.test(name)) return true;
  return false;
}

/** @returns {3|4|null} base day count before Sunday/bank-holiday extension */
function testsToCancelCourseProfile(courseAbb, courseName) {
  if (isMotorcycle3DayTestsToCancelCourse(courseAbb, courseName)) return 3;
  if (isModuleTest4DayTestsToCancelCourse(courseAbb, courseName)) return 4;
  return null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIsoLocal(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseIsoLocal(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayIso() {
  return toIsoLocal(new Date());
}

function addDaysIso(iso, days) {
  const d = parseIsoLocal(iso);
  d.setDate(d.getDate() + days);
  return toIsoLocal(d);
}

function diffCalendarDays(fromIso, toIso) {
  const from = parseIsoLocal(fromIso);
  const to = parseIsoLocal(toIso);
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function isTbcDate(value) {
  const raw = String(value ?? '').trim().slice(0, 10);
  if (!raw || raw === '0000-00-00' || raw === '1111-11-11') return true;
  const parsed = parseIsoLocal(raw);
  return Number.isNaN(parsed.getTime()) || parsed.getFullYear() < 1900;
}

function formatUkDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function formatLongDate(iso) {
  if (isTbcDate(iso)) return 'TBC';
  const d = parseIsoLocal(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
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

function formatLocationLabel(locAbb, locationName) {
  const abb = String(locAbb || '').trim();
  const name = String(locationName || '').trim();
  if (abb && name && abb.toLowerCase() !== name.toLowerCase()) {
    return `${abb} — ${name}`;
  }
  return abb || name || 'Location TBC';
}

function daysUntilLabel(days) {
  if (days <= 0) return 'Starts today';
  if (days === 1) return 'Starts tomorrow';
  return `Starts in ${days} days`;
}

function formatMoneyGbp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '£0.00';
  return `£${n.toFixed(2)}`;
}

/**
 * Sundays and England/Wales bank holidays (GOV.UK) from the day after `fromIso`
 * through the day before course start (start date itself is not counted).
 * Each adds +1 to the module (4) or motorcycle (3) day threshold.
 */
function countNonWorkingDaysInRange(fromIso, toIso) {
  if (toIso <= fromIso) return 0;
  let count = 0;
  let cur = parseIsoLocal(fromIso);
  cur.setDate(cur.getDate() + 1);
  const end = parseIsoLocal(toIso);
  end.setDate(end.getDate() - 1);
  if (end < cur) return 0;
  while (cur <= end) {
    const iso = toIsoLocal(cur);
    if (cur.getDay() === 0 || isEnglandBankHoliday(iso)) {
      count += 1;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Show tests-to-cancel alert when start is within `baseDays` calendar days,
 * plus one extra day per Sunday/bank holiday in (today, start].
 */
function isWithinAdjustedWindow(today, eventDate, baseDays) {
  if (isTbcDate(eventDate) || eventDate < today) return false;
  const calendarDays = diffCalendarDays(today, eventDate);
  if (calendarDays < 0) return false;
  const extra = countNonWorkingDaysInRange(today, eventDate);
  const threshold = baseDays + extra;
  return calendarDays <= threshold;
}


function formatEventTime(value) {
  if (!value) return '';
  const str = String(value).trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(str)) return str.slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(str)) return str;
  return str;
}

function formatEventTimeRange(start, end) {
  const s = formatEventTime(start);
  const e = formatEventTime(end);
  if (s && e) return `${s}–${e}`;
  return s || e || '';
}

const LINKED_3_DAY_ALERT_NAME = '3 Day Course';

function displayAbbForTestsToCancel(abb, courseName) {
  return {
    abb: String(abb || '').trim(),
    name: String(courseName || '').trim(),
  };
}

function isLinkedMultiEvent(eventType, parent) {
  return String(eventType || '').trim().toLowerCase() === 'multi' && Number(parent) > 0;
}

async function getTestsToCancelAlerts(pool) {
  await ensureEnglandBankHolidaysLoaded();

  const [courseRows] = await pool.query(
    `SELECT id, course_abb, course_name FROM courses WHERE status IN ('1', '2')`
  );
  const courseIds = [];
  const abbByCourseId = new Map();
  for (const row of courseRows || []) {
    const baseDays = testsToCancelCourseProfile(row.course_abb, row.course_name);
    if (baseDays == null) continue;
    courseIds.push(row.id);
    abbByCourseId.set(Number(row.id), {
      abb: String(row.course_abb || '').trim(),
      course_name: String(row.course_name || '').trim(),
      baseDays,
    });
  }
  if (!courseIds.length) return [];

  const today = todayIso();
  const horizon = addDaysIso(today, 90);

  // One row per course event, on that course's first real day. Later days of a
  // multi-day course are not separate alerts. Linked A1/A2/DAS courses share a
  // parent and one seat pool, so those collapse to a single "3 Day Course" alert.
  // A frozen sibling is omitted here; an unfrozen sibling still represents the group.
  const [rows] = await pool.query(
    `SELECT ce.id AS course_event_id,
            ce.course_id,
            ce.parent,
            ce.event_type,
            DATE_FORMAT(start_dates.start_date, '%Y-%m-%d') AS event_date,
            ced.event_start_time,
            ced.event_end_time,
            l.loc_abb,
            l.location_name
     FROM course_events ce
     INNER JOIN (
       SELECT course_event_id, MIN(event_date) AS start_date
       FROM course_event_dates
       WHERE event_date > '1900-01-01'
         AND event_date NOT IN ('1111-11-11', '0000-00-00')
       GROUP BY course_event_id
     ) start_dates ON start_dates.course_event_id = ce.id
     INNER JOIN course_event_dates ced
       ON ced.course_event_id = ce.id
      AND ced.event_date = start_dates.start_date
     LEFT JOIN locations l ON l.id = ce.location_id
     LEFT JOIN freeze f ON f.course_event_id = ce.id
     WHERE ce.status = '1'
       AND ce.course_id IN (?)
       AND start_dates.start_date >= ?
       AND start_dates.start_date <= ?
       AND f.id IS NULL
     ORDER BY start_dates.start_date ASC, ce.id ASC`,
    [courseIds, today, horizon]
  );

  const availCache = new Map();
  const alerts = [];
  const seenEventIds = new Set();
  const seenLinkedGroups = new Set();

  async function groupAvail(eventId) {
    const key = Number(eventId);
    if (!availCache.has(key)) {
      availCache.set(key, await getGroupAvailability(pool, key));
    }
    return availCache.get(key);
  }

  for (const row of rows || []) {
    const eventDate = String(row.event_date).slice(0, 10);
    if (isTbcDate(eventDate)) continue;

    const eventId = Number(row.course_event_id);
    if (seenEventIds.has(eventId)) continue;
    seenEventIds.add(eventId);

    const courseId = Number(row.course_id);
    const meta = abbByCourseId.get(courseId);
    if (!meta) continue;

    const linked3Day =
      meta.baseDays === 3 && isLinkedMultiEvent(row.event_type, row.parent);
    const linkedKey = linked3Day ? `${Number(row.parent)}:${eventDate}` : '';
    if (linkedKey && seenLinkedGroups.has(linkedKey)) continue;

    if (!isWithinAdjustedWindow(today, eventDate, meta.baseDays)) {
      if (linkedKey) seenLinkedGroups.add(linkedKey);
      continue;
    }

    const avail = await groupAvail(eventId);
    if (linkedKey) seenLinkedGroups.add(linkedKey);
    if (!avail || avail.availableSpaces <= 0) continue;

    const daysUntil = diffCalendarDays(today, eventDate);
    const locationLabel = formatLocationLabel(row.loc_abb, row.location_name);
    const startLabel = formatLongDate(eventDate);
    const spaces = avail.availableSpaces;
    const display = linked3Day
      ? { abb: LINKED_3_DAY_ALERT_NAME, name: LINKED_3_DAY_ALERT_NAME }
      : displayAbbForTestsToCancel(meta.abb, meta.course_name);
    const timeLabel = formatEventTimeRange(
      row.event_start_time,
      row.event_end_time
    );

    alerts.push({
      category: 'tests_to_cancel',
      message: '',
      course_abb: display.abb,
      course_name: display.name,
      course_event_id: eventId,
      start_date: eventDate,
      start_date_label: startLabel,
      event_start_time: formatEventTime(row.event_start_time) || null,
      event_end_time: formatEventTime(row.event_end_time) || null,
      time_label: timeLabel || null,
      location_label: locationLabel,
      spaces_available: spaces,
      days_until_start: daysUntil,
      days_until_label: daysUntilLabel(daysUntil),
      cancel_window_days: meta.baseDays,
      sort_key: `${eventDate}\t${timeLabel || ''}\t${eventId}`,
    });
  }

  alerts.sort((a, b) => String(a.sort_key).localeCompare(String(b.sort_key)));
  return alerts.map(({ sort_key, ...rest }) => rest);
}

async function getOutstandingPaymentAlerts(pool) {
  const today = todayIso();
  const end = addDaysIso(today, 7);

  const [rows] = await pool.query(
    `SELECT b.id AS booking_id,
            ba.first_name,
            ba.sur_name,
            b.payment_due,
            ba.booking_ref,
            c.course_abb,
            (
              SELECT MIN(DATE(ced.event_date))
              FROM course_event_dates ced
              WHERE ced.course_event_id = b.course_event_id
                AND ced.event_date > '1900-01-01'
            ) AS first_event_date
     FROM bookings b
     LEFT JOIN courses c ON c.id = b.course_id
     INNER JOIN booking_attendees ba
       ON ba.booking_id = b.id AND ba.\`primary\` = 1
     WHERE IFNULL(b.payment_due, 0) > 0
       AND b.status = 1
       AND IFNULL(b.on_hold, 0) = 0
     ORDER BY first_event_date ASC, ba.sur_name ASC, ba.first_name ASC`,
    []
  );

  const alerts = [];
  const seenBooking = new Set();

  for (const row of rows || []) {
    const bookingId = Number(row.booking_id);
    if (seenBooking.has(bookingId)) continue;

    let firstDate = row.first_event_date;
    if (firstDate instanceof Date) {
      firstDate = toIsoLocal(firstDate);
    } else if (firstDate) {
      firstDate = String(firstDate).slice(0, 10);
    }
    if (!firstDate || isTbcDate(firstDate)) continue;
    if (firstDate < today || firstDate > end) continue;

    seenBooking.add(bookingId);
    const firstName = String(row.first_name || '').trim();
    const surName = String(row.sur_name || '').trim();
    const name = `${firstName} ${surName}`.trim() || 'Customer';
    const dueLabel = formatMoneyGbp(row.payment_due);
    const courseAbb = String(row.course_abb || '').trim();
    alerts.push({
      category: 'outstanding_payments',
      message: `${name} has an outstanding balance of ${dueLabel} on their ${courseAbb || 'course'} course`,
      booking_id: bookingId,
      booking_ref: String(row.booking_ref || '').trim(),
      attendee_name: name,
      payment_due: Number(row.payment_due) || 0,
      payment_due_label: dueLabel,
      course_abb: courseAbb,
      course_start_date: firstDate,
      course_start_label: formatLongDate(firstDate),
      days_until_start: diffCalendarDays(today, firstDate),
      sort_key: firstDate,
    });
  }

  alerts.sort((a, b) => String(a.sort_key).localeCompare(String(b.sort_key)));
  return alerts.map(({ sort_key, ...rest }) => rest);
}

function addCalendarMonths(iso, months) {
  const d = parseIsoLocal(iso);
  d.setMonth(d.getMonth() + months);
  return toIsoLocal(d);
}

async function getInstructorBadgeAlerts(pool) {
  const { listInstructors } = require('./instructorsService');
  await listInstructors(pool, { page: 1, limit: 1 });

  const today = todayIso();
  const sixMonthsOut = addCalendarMonths(today, 6);

  const [rows] = await pool.query(
    `SELECT id, fname, lname, instructor_badge_expiry
     FROM itineraries
     WHERE status = 1
       AND instructor_badge_expiry IS NOT NULL
       AND instructor_badge_expiry != '0000-00-00'`
  );

  const alerts = [];

  for (const row of rows || []) {
    let expiry = row.instructor_badge_expiry;
    if (expiry instanceof Date) {
      expiry = toIsoLocal(expiry);
    } else {
      expiry = String(expiry).slice(0, 10);
    }
    if (isTbcDate(expiry)) continue;

    const first = String(row.fname || '').trim();
    const last = String(row.lname || '').trim();
    const name = `${first} ${last}`.trim() || 'Instructor';

    if (expiry < today) {
      alerts.push({
        category: 'instructor_badge',
        message: `${name} — badge expired`,
        instructor_id: Number(row.id),
        instructor_name: name,
        expiry_date: expiry,
        expiry_label: formatUkDate(expiry),
        is_expired: true,
        sort_key: `0-${expiry}`,
      });
      continue;
    }

    if (expiry <= sixMonthsOut) {
      alerts.push({
        category: 'instructor_badge',
        message: `${name} — badge expires ${formatUkDate(expiry)}`,
        instructor_id: Number(row.id),
        instructor_name: name,
        expiry_date: expiry,
        expiry_label: formatUkDate(expiry),
        is_expired: false,
        sort_key: `1-${expiry}`,
      });
    }
  }

  alerts.sort((a, b) => String(a.sort_key).localeCompare(String(b.sort_key)));
  return alerts.map(({ sort_key, ...rest }) => rest);
}

async function getDashboardAlerts(pool) {
  const [tests_to_cancel, outstanding_payments, instructor_badge] =
    await Promise.all([
      getTestsToCancelAlerts(pool),
      getOutstandingPaymentAlerts(pool),
      getInstructorBadgeAlerts(pool),
    ]);

  return {
    tests_to_cancel,
    outstanding_payments,
    instructor_badge,
    alerts: [...tests_to_cancel, ...outstanding_payments, ...instructor_badge],
  };
}

module.exports = {
  getDashboardAlerts,
  normalizeAbb,
  testsToCancelCourseProfile,
  isMotorcycle3DayTestsToCancelCourse,
  isModuleTest4DayTestsToCancelCourse,
  countNonWorkingDaysInRange,
  isWithinAdjustedWindow,
};
