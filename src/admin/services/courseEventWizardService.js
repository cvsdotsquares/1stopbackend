const { showMonthDashboard } = require('./moncalService');
const {
  createApiEventCourse,
  updateApiEventCourse,
  deleteApiEventCourse,
  freezeApiEventCourse,
} = require('./bookingApiAdminService');

const LOCATION_ARRAY = [1, 4, 15, 18];

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function normalizeDateKey(key) {
  if (key == null) return '';
  const trimmed = trim(key);
  if (!trimmed || trimmed === '0000-00-00' || trimmed.startsWith('0000')) {
    return '0000-00-00';
  }

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (year < 1901) {
      return '0000-00-00';
    }
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    if (parsed.getFullYear() < 1901) {
      return '0000-00-00';
    }
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }

  return trimmed;
}

function normalizeEventsDates(eventsDates) {
  if (!eventsDates || typeof eventsDates !== 'object') {
    return eventsDates;
  }
  const out = {};
  for (const [key, value] of Object.entries(eventsDates)) {
    out[normalizeDateKey(key)] = value;
  }
  return out;
}

const DEFAULT_EVENT_TIME = '00:00';

function ensureEventDateTimes(eventsDates) {
  const normalized = normalizeEventsDates(eventsDates || {});
  const out = {};
  for (const [key, val] of Object.entries(normalized)) {
    if (key === '0000-00-00') {
      out[key] = val;
      continue;
    }
    const entry = { ...(val || {}) };
    if (!trim(entry.s)) {
      entry.s = DEFAULT_EVENT_TIME;
    }
    if (!trim(entry.e)) {
      entry.e = DEFAULT_EVENT_TIME;
    }
    out[key] = entry;
  }
  return out;
}

function formatEventDateKey(rawDate) {
  if (rawDate == null) {
    return '0000-00-00';
  }
  if (rawDate instanceof Date) {
    if (Number.isNaN(rawDate.getTime()) || rawDate.getFullYear() < 1901) {
      return '0000-00-00';
    }
    return `${rawDate.getFullYear()}-${pad2(rawDate.getMonth() + 1)}-${pad2(rawDate.getDate())}`;
  }
  const str = String(rawDate).slice(0, 10);
  return normalizeDateKey(str);
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function ensureSession(req) {
  if (!req.session) {
    req.session = {};
  }
}

function getCourseEvent(req) {
  ensureSession(req);
  return req.session.courseEvent || null;
}

function setCourseEvent(req, data) {
  ensureSession(req);
  req.session.courseEvent = data;
}

function initEmptyCourseEvent() {
  return { franchise_id: 0, event_type: 'single' };
}

function ensureDefaultEventType(courseEvent) {
  if (!courseEvent.event_type) {
    courseEvent.event_type = 'single';
  }
  return courseEvent;
}

function monthNav(month, year) {
  const m = Number(month);
  const y = Number(year);
  const date = new Date(y, m - 1, 1);
  const prevDate = new Date(y, m - 2, 1);
  const nextDate = new Date(y, m, 1);
  return {
    prevMonth: prevDate.getMonth() + 1,
    prevYear: prevDate.getFullYear(),
    nextMonth: nextDate.getMonth() + 1,
    nextYear: nextDate.getFullYear(),
    monthLabel: date.toLocaleString('en-US', { month: 'long' }),
  };
}

async function getCourseSelectOptions(pool) {
  const [rows] = await pool.query(
    `SELECT id, course_name, default_booking_limit, default_manual_vehicle,
            default_automatic_vehicle, default_start_time, default_end_time, cancel_days
     FROM courses
     WHERE isDeleted = '0' AND (status = '1' OR status = '2')
     ORDER BY course_name`
  );
  return rows.map((row) => ({
    id: row.id,
    course_name: row.course_name,
    default_booking_limit: row.default_booking_limit,
    default_manual_vehicle: row.default_manual_vehicle,
    default_automatic_vehicle: row.default_automatic_vehicle,
    default_start_time: row.default_start_time,
    default_end_time: row.default_end_time,
    cancel_days: row.cancel_days ?? 0,
  }));
}

async function getLocationSelectOptions(pool) {
  const [rows] = await pool.query(
    "SELECT id, location_name FROM locations WHERE status = '1' ORDER BY location_name"
  );
  return rows;
}

async function getFranchiseToBePaidOptions(pool) {
  const [rows] = await pool.query(
    "SELECT id, franchise_name, prim_franch FROM franchise WHERE isDeleted = '0' AND status = '1' ORDER BY franchise_name"
  );
  return rows;
}

async function getEventFromDb(pool, id) {
  const [eventRows] = await pool.query(
    'SELECT * FROM course_events WHERE id = ? LIMIT 1',
    [Number(id)]
  );
  const row = eventRows[0];
  if (!row) {
    return null;
  }

  const eventsData = {
    id: row.id,
    event_type: row.event_type,
    location_id: row.location_id,
    franchise_id: row.franchise_id,
    booking_limit: row.booking_limit,
    multi: [
      {
        vehicle_type_manual: row.vehicle_type_manual,
        vehicle_type_automatic: row.vehicle_type_automatic,
        vehicle_type_own: row.vehicle_type_own,
        school_one_off_price: row.school_one_off_price,
        school_deposit_price: row.school_deposit_price,
        school_total_price: row.school_total_price,
        own_one_off_price: row.own_one_off_price,
        own_deposit_price: row.own_deposit_price,
        own_total_price: row.own_total_price,
        is_deposit: row.is_deposit,
        course: row.course_id,
      },
    ],
  };

  const [dateRows] = await pool.query(
    'SELECT * FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date',
    [Number(id)]
  );

  if (dateRows.length) {
    const eventsDates = {};
    for (const dt of dateRows) {
      const key = formatEventDateKey(dt.event_date);
      eventsDates[key] = {
        s: dt.event_start_time,
        e: dt.event_end_time,
      };
    }
    eventsData.eventsDates = eventsDates;
  }

  return eventsData;
}

async function getEventStartDates(pool, courseEventIds) {
  if (!courseEventIds?.length) {
    return {};
  }
  const ids = courseEventIds.map(Number).filter(Boolean);
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT course_event_dates.*, course_events.event_type, course_event_dates.id AS main_id
     FROM course_event_dates
     JOIN course_events ON course_events.id = course_event_dates.course_event_id
     WHERE course_event_dates.course_event_id IN (${placeholders})
     ORDER BY FIELD(course_event_dates.event_date, '0000-00-00') ASC`,
    ids
  );

  const data = {};
  for (const row of rows) {
    const eventId = row.course_event_id;
    const eventDate = formatEventDateKey(row.event_date);
    if (!data[eventId]) {
      data[eventId] = {};
    }
    data[eventId][eventDate] = {
      s: row.event_start_time,
      e: row.event_end_time,
      eid: row.course_event_id,
      main_id: row.main_id,
      etype: row.event_type,
      event_date: eventDate,
    };
  }
  return data;
}

function buildRedirectCode(eventsData, multipal = false) {
  if (!eventsData?.eventsDates) {
    return multipal ? 'multipal=true&edit' : 'edit';
  }
  for (const ek of Object.keys(eventsData.eventsDates)) {
    if (ek !== '0000-00-00') {
      const timestamp = new Date(ek).getTime();
      if (!Number.isNaN(timestamp)) {
        const d = new Date(timestamp);
        const month = pad2(d.getMonth() + 1);
        const year = d.getFullYear();
        return multipal
          ? `date=${month}&year=${year}&multipal=true&edit`
          : `date=${month}&year=${year}&edit`;
      }
    }
  }
  return multipal ? 'multipal=true&edit' : 'edit';
}

async function startWizardWithPool(pool, req, { editId } = {}) {
  ensureSession(req);
  if (editId) {
    const eventsData = await getEventFromDb(pool, editId);
    if (!eventsData) {
      return { error: 'Event not found to edit', code: 'edit' };
    }
    const redirectCode = buildRedirectCode(eventsData, false);
    setCourseEvent(req, eventsData);
    return { redirectCode, eventsData };
  }
  delete req.session.courseEvent;
  delete req.session.eventIds;
  return { cleared: true };
}

async function getStep1Data(pool, req, query = {}) {
  ensureSession(req);
  const now = new Date();
  const month = query.date || query.month || pad2(now.getMonth() + 1);
  const year = query.year || String(now.getFullYear());
  const calendar = showMonthDashboard(month, year);
  const nav = monthNav(Number(month), Number(year));

  let courseEvent = getCourseEvent(req);
  if (!courseEvent) {
    courseEvent = initEmptyCourseEvent();
  } else {
    ensureDefaultEventType(courseEvent);
    if (courseEvent.eventsDates) {
      courseEvent.eventsDates = normalizeEventsDates(courseEvent.eventsDates);
    }
  }
  setCourseEvent(req, courseEvent);

  const [courses, franchises] = await Promise.all([
    getCourseSelectOptions(pool),
    getFranchiseToBePaidOptions(pool),
  ]);

  return {
    courseEvent,
    calendar,
    nav: {
      month: Number(month),
      year: Number(year),
      ...nav,
    },
    courses,
    franchises,
    isEdit: Boolean(courseEvent?.id),
  };
}

function saveStep1(req, body = {}) {
  ensureSession(req);
  let courseEvent = getCourseEvent(req) || initEmptyCourseEvent();

  if (body.event_type === 'single' || body.event_type === 'multi') {
    courseEvent.event_type = body.event_type;
  }
  if (body.franchise_id != null) {
    courseEvent.franchise_id =
      trim(body.franchise_id) === '' ? 0 : Number(body.franchise_id);
  }
  if (body.eventsDates && typeof body.eventsDates === 'object') {
    courseEvent.eventsDates = body.eventsDates;
  }
  if (body.course != null) {
    if (!courseEvent.multi) {
      courseEvent.multi = [{}];
    }
    if (!courseEvent.multi[0]) {
      courseEvent.multi[0] = {};
    }
    courseEvent.multi[0].course =
      trim(body.course) === '' ? 0 : Number(body.course);
  }

  setCourseEvent(req, courseEvent);
  return courseEvent;
}

function applySessionPatch(req, body = {}) {
  ensureSession(req);
  if (!req.session.courseEvent) {
    req.session.courseEvent = initEmptyCourseEvent();
  }
  const ce = req.session.courseEvent;

  if (body.arrKey != null && body.arrKey !== '') {
    return applyArrKeyPatch(req, ce, body);
  }

  if (body.multi != null || hasNestedKey(body, 'multi')) {
    return applyMultiNestedPatch(req, ce, body);
  }

  if (body.eventsDates != null || hasNestedKey(body, 'eventsDates')) {
    return applyEventsDatesPatch(req, ce, body);
  }

  const firstKey = Object.keys(body).find(
    (k) => !['_csrf', 'multi', 'eventsDates', 'manual', 'automatic', 'bookinglimit', 'start', 'end'].includes(k)
  );
  if (firstKey) {
    let val = body[firstKey];
    if (firstKey === 'franchise_id' && trim(val) === '') {
      val = 0;
    }
    ce[firstKey] = val;
  }

  setCourseEvent(req, ce);
  return ce;
}

function hasNestedKey(body, key) {
  return Object.keys(body).some((k) => k === key || k.startsWith(`${key}[`));
}

function applyArrKeyPatch(req, ce, body) {
  const post = {
    arrKey: trim(body.arrKey),
    arrName: trim(body.arrName),
    fieldVal: trim(body.fieldVal),
    eveType: trim(body.eveType),
  };

  if (post.arrName === 'vehicle_type_own') {
    const idx = Number(post.arrKey);
    if (!ce.multi) ce.multi = [];
    if (!ce.multi[idx]) ce.multi[idx] = {};
    ce.multi[idx].vehicle_type_own = post.fieldVal;
    setCourseEvent(req, ce);
    return ce;
  }

  if (post.arrKey === 'event_type' && (post.fieldVal === 'single' || post.fieldVal === 'multi')) {
    ce.event_type = post.fieldVal;
    setCourseEvent(req, ce);
    return ce;
  }

  if (post.eveType === 'single' || post.eveType === 'multi') {
    ce.event_type = post.eveType;
  }

  if (post.fieldVal === '1') {
    if (post.arrName) {
      if (
        post.eveType === 'single' &&
        ce.id
      ) {
        ce[post.arrName] = {};
      }
      if (!ce[post.arrName]) {
        ce[post.arrName] = {};
      }
      const dateKey =
        post.arrName === 'eventsDates'
          ? normalizeDateKey(post.arrKey)
          : post.arrKey;
      ce[post.arrName][dateKey] = { s: DEFAULT_EVENT_TIME, e: DEFAULT_EVENT_TIME };
    } else {
      ce[post.arrKey] = post.fieldVal;
    }
  } else if (post.fieldVal === '0') {
    if (post.arrName) {
      if (ce[post.arrName]) {
        const dateKey =
          post.arrName === 'eventsDates'
            ? normalizeDateKey(post.arrKey)
            : post.arrKey;
        for (const existingKey of Object.keys(ce[post.arrName])) {
          if (normalizeDateKey(existingKey) === dateKey) {
            delete ce[post.arrName][existingKey];
          }
        }
      }
    } else {
      delete ce[post.arrKey];
    }
  } else if (post.arrName) {
    if (!ce[post.arrName]) {
      ce[post.arrName] = {};
    }
    const dateKey =
      post.arrName === 'eventsDates'
        ? normalizeDateKey(post.arrKey)
        : post.arrKey;
    ce[post.arrName][dateKey] = post.fieldVal;
  } else {
    ce[post.arrKey] = post.fieldVal;
  }

  if (ce.eventsDates) {
    ce.eventsDates = ensureEventDateTimes(normalizeEventsDates(ce.eventsDates));
  }

  setCourseEvent(req, ce);
  return ce;
}

function applyMultiNestedPatch(req, ce, body) {
  const multiBody = body.multi || extractNested(body, 'multi');
  if (!multiBody) {
    setCourseEvent(req, ce);
    return ce;
  }

  if (!ce.multi) ce.multi = [];

  for (const [firstSubKey, firstSubValue] of Object.entries(multiBody)) {
    const idx = Number(firstSubKey);
    if (!ce.multi[idx]) {
      ce.multi[idx] = {
        vehicle_type_own: 0,
        vehicle_type_manual: 0,
        vehicle_type_automatic: 0,
        school_one_off_price: 0,
        school_deposit_price: 0,
        school_total_price: 0,
        own_one_off_price: 0,
        own_deposit_price: 0,
        own_total_price: 0,
      };
    }

    for (const [field, val] of Object.entries(firstSubValue || {})) {
      if (field === 'course') {
        ce.multi[idx].course = trim(val) === '' ? 0 : val;
        if (body.manual != null) {
          ce.multi[idx].vehicle_type_manual =
            trim(body.manual) === '' ? 0 : body.manual;
        }
        if (body.automatic != null) {
          ce.multi[idx].vehicle_type_automatic =
            trim(body.automatic) === '' ? 0 : body.automatic;
        }
        if (body.bookinglimit != null) {
          ce.booking_limit = body.bookinglimit;
          if (ce.eventsDates) {
            for (const ke of Object.keys(ce.eventsDates)) {
              if (ke !== '0000-00-00') {
                ce.eventsDates[ke] = {
                  s: body.start || '',
                  e: body.end || '',
                };
              }
            }
          }
        }
      } else {
        ce.multi[idx][field] = trim(val) === '' ? 0 : val;
      }
    }
  }

  setCourseEvent(req, ce);
  return ce;
}

function applyEventsDatesPatch(req, ce, body) {
  const datesBody = body.eventsDates || extractNested(body, 'eventsDates');
  if (!datesBody) {
    setCourseEvent(req, ce);
    return ce;
  }

  if (!ce.eventsDates) ce.eventsDates = {};

  for (const [dateKey, patch] of Object.entries(datesBody)) {
    const normalizedKey = normalizeDateKey(dateKey);
    if (patch && typeof patch === 'object' && ('s' in patch || 'e' in patch)) {
      ce.eventsDates[normalizedKey] = {
        ...(ce.eventsDates[normalizedKey] || { s: DEFAULT_EVENT_TIME, e: DEFAULT_EVENT_TIME }),
        ...patch,
      };
      continue;
    }

    const firstSubValue = patch;
    const firstSub1Key = Object.keys(firstSubValue || {})[0];
    const firstSub1Value = firstSubValue?.[firstSub1Key];
    const oldTimeArr = ce.eventsDates[dateKey];
    if (oldTimeArr && typeof oldTimeArr === 'object') {
      oldTimeArr[firstSub1Key] = firstSub1Value;
      ce.eventsDates[dateKey] = oldTimeArr;
    } else {
      ce.eventsDates[dateKey] = { [firstSub1Key]: firstSub1Value };
    }
  }

  setCourseEvent(req, ce);
  if (ce.eventsDates) {
    ce.eventsDates = ensureEventDateTimes(normalizeEventsDates(ce.eventsDates));
  }
  return ce;
}

function extractNested(body, prefix) {
  const result = {};
  const re = new RegExp(`^${prefix}\\[(\\d+)\\]\\[(\\w+)\\]$`);
  for (const [key, value] of Object.entries(body)) {
    const match = key.match(re);
    if (match) {
      const [, idx, field] = match;
      if (!result[idx]) result[idx] = {};
      result[idx][field] = value;
    }
  }
  const dateRe = /^eventsDates\[([^\]]+)\]\[(\w+)\]$/;
  if (prefix === 'eventsDates') {
    const dateResult = {};
    for (const [key, value] of Object.entries(body)) {
      const match = key.match(dateRe);
      if (match) {
        const [, dateKey, field] = match;
        if (!dateResult[dateKey]) dateResult[dateKey] = {};
        dateResult[dateKey][field] = value;
      }
    }
    if (Object.keys(dateResult).length) {
      return dateResult;
    }
  }
  return Object.keys(result).length ? result : null;
}

function validateStep2Session(req) {
  const ce = getCourseEvent(req);
  if (
    !ce ||
    !ce.eventsDates ||
    !Object.keys(ce.eventsDates).length ||
    !ce.event_type
  ) {
    if (ce?.id) {
      return {
        valid: false,
        message: 'Please first fill out date(s) of course',
      };
    }
    return {
      valid: false,
      message: 'Please first fill out Course type and date(s) of course',
    };
  }
  return { valid: true, courseEvent: ce };
}

async function isEventFrozen(pool, eventId) {
  const [rows] = await pool.query(
    'SELECT COUNT(id) AS count_freeze FROM freeze WHERE course_event_id = ?',
    [Number(eventId)]
  );
  return Number(rows[0]?.count_freeze || 0) > 0;
}

async function isEventDeposit(pool, eventId) {
  if (!eventId) return 0;
  const [rows] = await pool.query(
    'SELECT is_deposit FROM course_events WHERE id = ? LIMIT 1',
    [Number(eventId)]
  );
  return Number(rows[0]?.is_deposit || 0);
}

function sortEventsDates(eventsDates) {
  const normalized = ensureEventDateTimes(eventsDates || {});
  const keys = Object.keys(normalized).sort((a, b) => {
    if (a === '0000-00-00') return 1;
    if (b === '0000-00-00') return -1;
    return a.localeCompare(b);
  });
  const result = {};
  for (const k of keys) {
    result[k] = normalized[k];
  }
  return result;
}

async function getStep2Data(pool, req, { multipal = false } = {}) {
  const validation = validateStep2Session(req);
  if (!validation.valid) {
    return { error: validation.message };
  }

  let courseEvent = validation.courseEvent;
  if (!courseEvent.multi?.[0]) {
    courseEvent.multi = [{}];
  }
  if (courseEvent.eventsDates) {
    courseEvent.eventsDates = ensureEventDateTimes(
      normalizeEventsDates(courseEvent.eventsDates)
    );
    setCourseEvent(req, courseEvent);
  }

  const [courses, locations, franchises] = await Promise.all([
    getCourseSelectOptions(pool),
    getLocationSelectOptions(pool),
    getFranchiseToBePaidOptions(pool),
  ]);

  const primaryFranchise = franchises.find((f) => String(f.prim_franch) === '1');
  if (!courseEvent.franchise_id && primaryFranchise) {
    courseEvent.franchise_id = primaryFranchise.id;
  }

  const isFrozen = courseEvent.id
    ? await isEventFrozen(pool, courseEvent.id)
    : false;
  const isDeposit = courseEvent.id
    ? await isEventDeposit(pool, courseEvent.id)
    : 0;

  if (multipal && req.session.eventIds?.length) {
    const multipalEventDates = await getEventStartDates(
      pool,
      req.session.eventIds
    );
    return {
      courseEvent,
      courses,
      locations,
      franchises,
      multipal: true,
      isFrozen,
      isDeposit,
      eventIds: req.session.eventIds || [],
      sortedDates: sortEventsDates(courseEvent.eventsDates || {}),
      multipalEventDates,
    };
  }

  return {
    courseEvent,
    courses,
    locations,
    franchises,
    multipal: Boolean(multipal),
    isFrozen,
    isDeposit,
    eventIds: req.session.eventIds || [],
    sortedDates: sortEventsDates(courseEvent.eventsDates || {}),
    multipalEventDates: null,
  };
}

async function setSingleFrozenDate(pool, eventId, ceDate, eStartTime, eEndTime, freeze) {
  if (!ceDate || !eventId) return;

  const normalizedDate = trim(ceDate) === 'TBC' ? '0000-00-00' : trim(ceDate);

  if (Number(freeze) === 1) {
    const [countRows] = await pool.query(
      'SELECT COUNT(id) AS count_freeze FROM freeze WHERE course_event_id = ?',
      [Number(eventId)]
    );
    if (Number(countRows[0]?.count_freeze || 0) === 0) {
      const [eventRows] = await pool.query(
        'SELECT * FROM course_events WHERE id = ? LIMIT 1',
        [Number(eventId)]
      );
      const eventData = eventRows[0];
      if (!eventData) return;

      await pool.query(
        `INSERT INTO freeze (parent, course_event_id, bookings_done, vehicle_type_manual,
         vehicle_type_automatic, booking_limit, manual_lock_done, automatic_lock_done)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventData.parent,
          eventId,
          eventData.bookings_done,
          eventData.vehicle_type_manual,
          eventData.vehicle_type_automatic,
          eventData.booking_limit,
          eventData.manual_lock_done,
          eventData.automatic_lock_done,
        ]
      );

      const totalBookingDone =
        Number(eventData.vehicle_type_manual) +
        Number(eventData.vehicle_type_automatic);
      await pool.query('UPDATE course_events SET bookings_done = ? WHERE id = ?', [
        totalBookingDone,
        eventId,
      ]);
      await pool.query(
        `UPDATE course_event_dates SET freeze = 1
         WHERE course_event_id = ? AND event_date = ? AND event_start_time = ? AND event_end_time = ?`,
        [eventId, normalizedDate, trim(eStartTime), trim(eEndTime)]
      );
    }
  } else {
    const [countRows] = await pool.query(
      'SELECT COUNT(id) AS count_freeze, id FROM freeze WHERE course_event_id = ?',
      [Number(eventId)]
    );
    const countFreeze = Number(countRows[0]?.count_freeze || 0);
    const freezeId = countRows[0]?.id;
    if (countFreeze && freezeId) {
      const [freezeRows] = await pool.query(
        'SELECT * FROM freeze WHERE course_event_id = ? LIMIT 1',
        [Number(eventId)]
      );
      const freezeData = freezeRows[0];
      if (freezeData) {
        await pool.query(
          `UPDATE course_events SET automatic_lock_done = ?, manual_lock_done = ?,
           vehicle_type_automatic = ?, vehicle_type_manual = ?, bookings_done = ?
           WHERE id = ?`,
          [
            freezeData.automatic_lock_done,
            freezeData.manual_lock_done,
            freezeData.vehicle_type_automatic,
            freezeData.vehicle_type_manual,
            freezeData.bookings_done,
            eventId,
          ]
        );
        await pool.query(
          'DELETE FROM freeze WHERE course_event_id = ? AND id = ?',
          [eventId, freezeId]
        );
        await pool.query(
          `UPDATE course_event_dates SET freeze = 2
           WHERE course_event_id = ? AND event_date = ? AND event_start_time = ? AND event_end_time = ?`,
          [eventId, normalizedDate, trim(eStartTime), trim(eEndTime)]
        );
      }
    }
  }
}

async function setMultipleFrozenDate(pool, eventId, ceDates, freeze) {
  if (!ceDates || !eventId) return;
  for (const [ceDate, ceTime] of Object.entries(ceDates)) {
    await setSingleFrozenDate(
      pool,
      eventId,
      ceDate,
      ceTime.s,
      ceTime.e,
      freeze
    );
  }
}

async function saveStep2(pool, req, body = {}, { multipal = false } = {}) {
  const validation = validateStep2Session(req);
  if (!validation.valid) {
    return { success: false, message: validation.message };
  }

  let eventsData = { ...validation.courseEvent };

  if (body.location_id != null) {
    eventsData.location_id = body.location_id;
  }
  if (body.franchise_id != null) {
    eventsData.franchise_id = body.franchise_id;
  }
  if (body.booking_limit != null) {
    eventsData.booking_limit = body.booking_limit;
  }
  if (body.multi) {
    eventsData.multi = body.multi;
  }
  if (body.eventsDates && !multipal) {
    for (const [dateKey, times] of Object.entries(body.eventsDates)) {
      if (eventsData.eventsDates?.[dateKey]) {
        eventsData.eventsDates[dateKey] = {
          ...eventsData.eventsDates[dateKey],
          ...times,
        };
      }
    }
  }

  setCourseEvent(req, eventsData);

  const locationId = trim(body.location_id ?? eventsData.location_id);
  const bookingLimit = trim(body.booking_limit ?? eventsData.booking_limit);

  if (locationId === '' || bookingLimit === '') {
    return {
      success: false,
      message: 'Required fields marked with * can not be left blank',
    };
  }

  const freezeAllDates =
    body.frozenAllDates === 1 ||
    body.frozenAllDates === '1' ||
    body.frozenAllDates === true
      ? 1
      : 0;
  const depositValue =
    body.is_deposit === 1 ||
    body.is_deposit === '1' ||
    body.is_deposit === true
      ? 1
      : 0;

  if (multipal) {
    return saveStep2Multipal(pool, req, eventsData, body, {
      freezeAllDates,
      depositValue,
    });
  }

  return saveStep2Normal(pool, req, eventsData, {
    freezeAllDates,
    depositValue,
  });
}

async function saveStep2Multipal(pool, req, eventsData, body, opts) {
  const { freezeAllDates, depositValue } = opts;
  const postDates = body.eventsDates || {};
  const multipleEvents = [];
  let bookingLimitError = false;

  for (const edatas of Object.values(postDates)) {
    for (const [eDate, eData] of Object.entries(edatas)) {
      if (!eData?.eid || !eData?.main_id) continue;

      const eventId = Number(eData.eid);
      const dateRowId = Number(eData.main_id);

      const [ceRows] = await pool.query(
        'SELECT * FROM course_events WHERE id = ? LIMIT 1',
        [eventId]
      );
      const ceDel = ceRows[0];
      if (ceDel) {
        const cbks = Number(ceDel.current_locks) + Number(ceDel.bookings_done);
        if (Number(eventsData.booking_limit) < cbks) {
          bookingLimitError = true;
          break;
        }
      }

      const multi0 = eventsData.multi?.[0] || {};
      await pool.query(
        `UPDATE course_events SET event_type = ?, course_id = ?, location_id = ?, franchise_id = ?,
         booking_limit = ?, vehicle_type_manual = ?, vehicle_type_automatic = ?, vehicle_type_own = ?,
         school_one_off_price = ?, school_deposit_price = ?, school_total_price = ?,
         own_one_off_price = ?, own_deposit_price = ?, own_total_price = ?, modified = ?, is_deposit = ?
         WHERE id = ?`,
        [
          trim(eventsData.event_type),
          trim(multi0.course),
          trim(eventsData.location_id),
          trim(eventsData.franchise_id),
          trim(eventsData.booking_limit),
          trim(multi0.vehicle_type_manual),
          trim(multi0.vehicle_type_automatic),
          trim(multi0.vehicle_type_own),
          trim(multi0.school_one_off_price),
          trim(multi0.school_deposit_price),
          trim(multi0.school_total_price),
          trim(multi0.own_one_off_price),
          trim(multi0.own_deposit_price),
          trim(multi0.own_total_price),
          formatTimestamp(),
          depositValue,
          eventId,
        ]
      );

      await pool.query(
        'UPDATE course_event_dates SET event_start_time = ?, event_end_time = ? WHERE id = ?',
        [trim(eData.s), trim(eData.e), dateRowId]
      );

      await setSingleFrozenDate(
        pool,
        eventId,
        eDate,
        eData.s,
        eData.e,
        freezeAllDates
      );

      if (!multipleEvents.includes(eventId)) {
        multipleEvents.push(eventId);
      }
    }
    if (bookingLimitError) break;
  }

  if (bookingLimitError) {
    return {
      success: false,
      message: 'Booking Limit can not be less then current bookings',
    };
  }

  const multipleEventsCourseId = trim(eventsData.multi?.[0]?.course);
  const multipleEventsLocationId = trim(eventsData.location_id);

  for (const eventId of multipleEvents) {
    if (Number(multipleEventsCourseId) !== 1) {
      await deleteApiEventCourse(pool, eventId);
    } else if (!LOCATION_ARRAY.includes(Number(multipleEventsLocationId))) {
      await deleteApiEventCourse(pool, eventId);
    } else {
      await updateApiEventCourse(pool, eventId);
      await freezeApiEventCourse(pool, eventId);
    }
  }

  delete req.session.courseEvent;
  delete req.session.eventIds;

  return {
    success: true,
    message: 'Course event saved successfully',
    redirect: '/admin/course-events',
  };
}

async function saveStep2Normal(pool, req, eventsData, opts) {
  const { freezeAllDates, depositValue } = opts;
  let parentId = 0;
  let lastId = 0;
  let inserted = 0;
  let bookingLimitError = false;

  for (const event of eventsData.multi || [{}]) {
    if (eventsData.event_type === 'multi') {
      if (eventsData.id) {
        const [ceRows] = await pool.query(
          'SELECT * FROM course_events WHERE id = ? LIMIT 1',
          [Number(eventsData.id)]
        );
        const ceDel = ceRows[0];
        if (ceDel) {
          const cbks = Number(ceDel.current_locks) + Number(ceDel.bookings_done);
          if (Number(eventsData.booking_limit) < cbks) {
            bookingLimitError = true;
            break;
          }
        }

        await pool.query('DELETE FROM course_event_dates WHERE course_event_id = ?', [
          eventsData.id,
        ]);

        const [result] = await pool.query(
          `UPDATE course_events SET event_type = ?, course_id = ?, location_id = ?, franchise_id = ?,
           booking_limit = ?, vehicle_type_manual = ?, vehicle_type_automatic = ?, vehicle_type_own = ?,
           school_one_off_price = ?, school_deposit_price = ?, school_total_price = ?,
           own_one_off_price = ?, own_deposit_price = ?, own_total_price = ?, modified = ?, is_deposit = ?
           WHERE id = ?`,
          [
            trim(eventsData.event_type),
            trim(event.course),
            trim(eventsData.location_id),
            trim(eventsData.franchise_id),
            trim(eventsData.booking_limit),
            trim(event.vehicle_type_manual),
            trim(event.vehicle_type_automatic),
            trim(event.vehicle_type_own),
            trim(event.school_one_off_price),
            trim(event.school_deposit_price),
            trim(event.school_total_price),
            trim(event.own_one_off_price),
            trim(event.own_deposit_price),
            trim(event.own_total_price),
            formatTimestamp(),
            depositValue,
            eventsData.id,
          ]
        );
        inserted = result.affectedRows;
        lastId = eventsData.id;
      } else {
        const [result] = await pool.query(
          `INSERT INTO course_events (event_type, course_id, location_id, franchise_id, booking_limit,
           vehicle_type_manual, vehicle_type_automatic, vehicle_type_own, school_one_off_price,
           school_deposit_price, school_total_price, own_one_off_price, own_deposit_price,
           own_total_price, parent, status, created, is_deposit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            trim(eventsData.event_type),
            trim(event.course),
            trim(eventsData.location_id),
            trim(eventsData.franchise_id),
            trim(eventsData.booking_limit),
            trim(event.vehicle_type_manual),
            trim(event.vehicle_type_automatic),
            trim(event.vehicle_type_own),
            trim(event.school_one_off_price),
            trim(event.school_deposit_price),
            trim(event.school_total_price),
            trim(event.own_one_off_price),
            trim(event.own_deposit_price),
            trim(event.own_total_price),
            parentId,
            '1',
            formatTimestamp(),
            depositValue,
          ]
        );
        lastId = result.insertId;
        inserted = result.affectedRows;
        if (!parentId) {
          parentId = lastId;
        }
      }

      for (const [ek, ev] of Object.entries(eventsData.eventsDates || {})) {
        await pool.query(
          `INSERT INTO course_event_dates (course_event_id, event_date, event_start_time, event_end_time)
           VALUES (?, ?, ?, ?)`,
          [lastId, trim(ek), trim(ev.s), trim(ev.e)]
        );
      }

      await setMultipleFrozenDate(pool, lastId, eventsData.eventsDates, freezeAllDates);

      if (
        Number(event.course) === 1 &&
        LOCATION_ARRAY.includes(Number(eventsData.location_id))
      ) {
        await updateApiEventCourse(pool, lastId);
      }
    } else if (eventsData.event_type === 'single') {
      for (const [ek, ev] of Object.entries(eventsData.eventsDates || {})) {
        if (eventsData.id) {
          const [ceRows] = await pool.query(
            'SELECT * FROM course_events WHERE id = ? LIMIT 1',
            [Number(eventsData.id)]
          );
          const ceDel = ceRows[0];
          if (ceDel) {
            const cbks = Number(ceDel.current_locks) + Number(ceDel.bookings_done);
            if (Number(eventsData.booking_limit) < cbks) {
              bookingLimitError = true;
              break;
            }
          }

          await pool.query('DELETE FROM course_event_dates WHERE course_event_id = ?', [
            eventsData.id,
          ]);

          const [result] = await pool.query(
            `UPDATE course_events SET event_type = ?, course_id = ?, location_id = ?, franchise_id = ?,
             booking_limit = ?, vehicle_type_manual = ?, vehicle_type_automatic = ?, vehicle_type_own = ?,
             school_one_off_price = ?, school_deposit_price = ?, school_total_price = ?,
             own_one_off_price = ?, own_deposit_price = ?, own_total_price = ?, modified = ?, is_deposit = ?
             WHERE id = ?`,
            [
              trim(eventsData.event_type),
              trim(event.course),
              trim(eventsData.location_id),
              trim(eventsData.franchise_id),
              trim(eventsData.booking_limit),
              trim(event.vehicle_type_manual),
              trim(event.vehicle_type_automatic),
              trim(event.vehicle_type_own),
              trim(event.school_one_off_price),
              trim(event.school_deposit_price),
              trim(event.school_total_price),
              trim(event.own_one_off_price),
              trim(event.own_deposit_price),
              trim(event.own_total_price),
              formatTimestamp(),
              depositValue,
              eventsData.id,
            ]
          );
          inserted = result.affectedRows;
          lastId = eventsData.id;

          await pool.query(
            `INSERT INTO course_event_dates (course_event_id, event_date, event_start_time, event_end_time)
             VALUES (?, ?, ?, ?)`,
            [lastId, trim(ek), trim(ev.s), trim(ev.e)]
          );

          if (freezeAllDates >= 1) {
            await setSingleFrozenDate(pool, lastId, ek, ev.s, ev.e, freezeAllDates);
          }

          if (
            Number(event.course) === 1 &&
            LOCATION_ARRAY.includes(Number(eventsData.location_id))
          ) {
            await updateApiEventCourse(pool, lastId);
            await freezeApiEventCourse(pool, lastId);
          }
          break;
        }

        const [result] = await pool.query(
          `INSERT INTO course_events (event_type, course_id, location_id, franchise_id, booking_limit,
           vehicle_type_manual, vehicle_type_automatic, vehicle_type_own, school_one_off_price,
           school_deposit_price, school_total_price, own_one_off_price, own_deposit_price,
           own_total_price, parent, status, created, is_deposit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            trim(eventsData.event_type),
            trim(event.course),
            trim(eventsData.location_id),
            trim(eventsData.franchise_id),
            trim(eventsData.booking_limit),
            trim(event.vehicle_type_manual),
            trim(event.vehicle_type_automatic),
            trim(event.vehicle_type_own),
            trim(event.school_one_off_price),
            trim(event.school_deposit_price),
            trim(event.school_total_price),
            trim(event.own_one_off_price),
            trim(event.own_deposit_price),
            trim(event.own_total_price),
            parentId,
            '1',
            formatTimestamp(),
            depositValue,
          ]
        );
        parentId = result.insertId;
        inserted = result.affectedRows;

        await pool.query('UPDATE course_events SET parent = ? WHERE id = ?', [
          parentId,
          parentId,
        ]);

        await pool.query(
          `INSERT INTO course_event_dates (course_event_id, event_date, event_start_time, event_end_time)
           VALUES (?, ?, ?, ?)`,
          [parentId, trim(ek), trim(ev.s), trim(ev.e)]
        );

        if (freezeAllDates >= 1) {
          await setSingleFrozenDate(pool, parentId, ek, ev.s, ev.e, freezeAllDates);
        }

        if (
          Number(event.course) === 1 &&
          LOCATION_ARRAY.includes(Number(eventsData.location_id))
        ) {
          await createApiEventCourse(pool, parentId);
        }
      }
    }
    if (bookingLimitError) break;
  }

  if (bookingLimitError) {
    return {
      success: false,
      message: 'Booking Limit can not be less then current bookings',
    };
  }

  if (!eventsData.id && eventsData.event_type === 'multi' && parentId) {
    await pool.query('UPDATE course_events SET parent = ? WHERE id = ?', [
      parentId,
      parentId,
    ]);
  }

  if (inserted > 0) {
    delete req.session.courseEvent;
    delete req.session.eventIds;
    return {
      success: true,
      message: 'Course event saved successfully',
      redirect: '/admin/course-events',
    };
  }

  return { success: false, message: 'Error in saving course event' };
}

function buildMultiFragment(req, linkNo) {
  const ce = getCourseEvent(req) || initEmptyCourseEvent();
  const idx = Number(linkNo);
  if (!ce.multi) ce.multi = [];
  const multi = ce.multi[idx] || {};
  if (!ce.multi[idx]) {
    ce.multi[idx] = {};
    setCourseEvent(req, ce);
  }
  return { linkNo: idx, multi, courseEvent: ce };
}

function removeMultiLink(req, linkNo) {
  const ce = getCourseEvent(req);
  if (!ce?.multi) return ce;
  delete ce.multi[Number(linkNo)];
  ce.multi = Object.values(ce.multi);
  setCourseEvent(req, ce);
  return ce;
}

async function editLoad(pool, req, { editId, doAction, eventIds = [] } = {}) {
  const eventsData = await getEventFromDb(pool, editId);
  if (!eventsData) {
    return {
      success: false,
      message: 'Event not found to edit',
      redirectCode: 'edit',
    };
  }

  const multipal = doAction === 'editmultipal';
  const redirectCode = buildRedirectCode(eventsData, multipal);

  setCourseEvent(req, eventsData);
  const stored = getCourseEvent(req);
  if (stored?.eventsDates) {
    stored.eventsDates = ensureEventDateTimes(normalizeEventsDates(stored.eventsDates));
    setCourseEvent(req, stored);
  }

  if (multipal && eventIds?.length) {
    req.session.eventIds = eventIds.map(Number);
  } else {
    delete req.session.eventIds;
  }

  return {
    success: true,
    redirectCode,
    redirectHints: {
      edit: true,
      multipal,
      date: redirectCode.match(/date=(\d+)/)?.[1] || null,
      year: redirectCode.match(/year=(\d+)/)?.[1] || null,
    },
    courseEvent: eventsData,
  };
}

function isStep1Valid(req) {
  const ce = getCourseEvent(req);
  return Boolean(
    ce?.event_type &&
      ce?.eventsDates &&
      Object.keys(ce.eventsDates).length > 0
  );
}

module.exports = {
  LOCATION_ARRAY,
  getCourseEvent,
  setCourseEvent,
  initEmptyCourseEvent,
  startWizardWithPool,
  getStep1Data,
  saveStep1,
  applySessionPatch,
  validateStep2Session,
  getStep2Data,
  saveStep2,
  getEventFromDb,
  editLoad,
  buildMultiFragment,
  removeMultiLink,
  getCourseSelectOptions,
  getLocationSelectOptions,
  getFranchiseToBePaidOptions,
  getEventStartDates,
  isStep1Valid,
  sortEventsDates,
  setSingleFrozenDate,
};
