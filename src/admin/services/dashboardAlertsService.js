/**
 * Home dashboard Alerts widget (global; not filtered by crs_scr / loc_scr).
 */
const { isEnglandBankHoliday } = require('../../utils/ukEnglandBankHolidays');
const {
  getGroupRootId,
  getGroupAvailability,
  isCourseEventFrozen,
} = require('../../utils/courseEventGroup');

const MOTORCYCLE_ABBREVS = new Set([
  '3 day a1',
  '3 day a2',
  '3 day das',
]);

const MODULE_TEST_ABBREVS = new Set([
  'module 1 test day',
  'mod 1 resit',
  'mod 1 test day',
  'module 2 test day',
  'mod 2 test day',
]);

function normalizeAbb(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
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

/** Sundays and England bank holidays from day after `fromIso` through `toIso` inclusive. */
function countNonWorkingDaysInRange(fromIso, toIso) {
  if (toIso <= fromIso) return 0;
  let count = 0;
  let cur = parseIsoLocal(fromIso);
  cur.setDate(cur.getDate() + 1);
  const end = parseIsoLocal(toIso);
  while (cur <= end) {
    const iso = toIsoLocal(cur);
    if (cur.getDay() === 0 || isEnglandBankHoliday(iso)) {
      count += 1;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function isWithinAdjustedWindow(today, eventDate, baseDays) {
  if (isTbcDate(eventDate) || eventDate < today) return false;
  const calendarDays = diffCalendarDays(today, eventDate);
  if (calendarDays < 0) return false;
  const extra = countNonWorkingDaysInRange(today, eventDate);
  const threshold = baseDays + extra;
  return calendarDays <= threshold;
}

function baseDaysForAbb(courseAbb) {
  const norm = normalizeAbb(courseAbb);
  if (MOTORCYCLE_ABBREVS.has(norm)) return 5;
  if (MODULE_TEST_ABBREVS.has(norm)) return 4;
  return null;
}

async function getTestsToCancelAlerts(pool) {
  const [courseRows] = await pool.query(
    `SELECT id, course_abb, course_name FROM courses WHERE status IN ('1', '2')`
  );
  const courseIds = [];
  const abbByCourseId = new Map();
  for (const row of courseRows || []) {
    const baseDays = baseDaysForAbb(row.course_abb);
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

  const [rows] = await pool.query(
    `SELECT ce.id AS course_event_id,
            ce.course_id,
            DATE_FORMAT(ced.event_date, '%Y-%m-%d') AS event_date,
            l.loc_abb,
            l.location_name
     FROM course_events ce
     INNER JOIN course_event_dates ced ON ced.course_event_id = ce.id
     LEFT JOIN locations l ON l.id = ce.location_id
     LEFT JOIN freeze f ON f.course_event_id = ce.id
     WHERE ce.status = '1'
       AND ce.course_id IN (?)
       AND ced.event_date >= ?
       AND ced.event_date <= ?
       AND ced.event_date > '1900-01-01'
       AND f.id IS NULL
     ORDER BY ced.event_date ASC`,
    [courseIds, today, horizon]
  );

  const rootCache = new Map();
  const availCache = new Map();
  const frozenCache = new Map();
  const alerts = [];

  async function groupRoot(eventId) {
    const key = Number(eventId);
    if (!rootCache.has(key)) {
      const root = (await getGroupRootId(pool, key)) || key;
      rootCache.set(key, root);
    }
    return rootCache.get(key);
  }

  async function groupAvail(eventId) {
    const key = Number(eventId);
    if (!availCache.has(key)) {
      availCache.set(key, await getGroupAvailability(pool, key));
    }
    return availCache.get(key);
  }

  async function eventFrozen(eventId) {
    const key = Number(eventId);
    if (!frozenCache.has(key)) {
      frozenCache.set(key, await isCourseEventFrozen(pool, key));
    }
    return frozenCache.get(key);
  }

  /** One alert per course package (linked cohort or single event), using day 1 only. */
  const packages = new Map();

  for (const row of rows || []) {
    const eventDate = String(row.event_date).slice(0, 10);
    if (isTbcDate(eventDate)) continue;

    const eventId = Number(row.course_event_id);
    const rootId = await groupRoot(eventId);
    const packageKey = String(rootId);
    const courseId = Number(row.course_id);

    const existing = packages.get(packageKey);
    if (!existing) {
      packages.set(packageKey, {
        rootId,
        eventId,
        courseId,
        firstDate: eventDate,
        loc_abb: row.loc_abb,
        location_name: row.location_name,
      });
      continue;
    }
    if (eventDate < existing.firstDate) {
      existing.firstDate = eventDate;
      existing.eventId = eventId;
      existing.loc_abb = row.loc_abb;
      existing.location_name = row.location_name;
    }
  }

  for (const pkg of packages.values()) {
    const meta = abbByCourseId.get(pkg.courseId);
    if (!meta) continue;
    if (!isWithinAdjustedWindow(today, pkg.firstDate, meta.baseDays)) continue;
    if (await eventFrozen(pkg.eventId)) continue;

    const avail = await groupAvail(pkg.eventId);
    if (!avail || avail.availableSpaces <= 0) continue;

    const daysUntil = diffCalendarDays(today, pkg.firstDate);
    const locationLabel = formatLocationLabel(pkg.loc_abb, pkg.location_name);
    const startLabel = formatLongDate(pkg.firstDate);
    const spaces = avail.availableSpaces;

    alerts.push({
      category: 'tests_to_cancel',
      message: `${meta.abb}: cancel module tests — ${startLabel} (${spaces} space${spaces === 1 ? '' : 's'} left)`,
      course_abb: meta.abb,
      course_name: meta.course_name,
      course_event_id: pkg.rootId,
      start_date: pkg.firstDate,
      start_date_label: startLabel,
      location_label: locationLabel,
      spaces_available: spaces,
      days_until_start: daysUntil,
      days_until_label: daysUntilLabel(daysUntil),
      cancel_window_days: meta.baseDays,
      sort_key: pkg.firstDate,
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
      message: `${name} has ${dueLabel} on their upcoming course`,
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
  baseDaysForAbb,
  countNonWorkingDaysInRange,
  isWithinAdjustedWindow,
};
