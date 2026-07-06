const { LOCK_EXPIRE_TIME_MINUTES } = require('../constants');
const {
  updateApiEventCourse,
  freezeApiEventCourse,
} = require('./bookingApiAdminService');
const { removeExpirelocks } = require('./bookingService');
const { setSingleFrozenDate } = require('./courseEventWizardService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function formatTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
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

/** Port of Booking::eventDatesArr */
function buildEventDates(dateRows) {
  const dates = {};
  let tbc = false;

  for (const row of dateRows) {
    const eventDate = formatDateValue(row.event_date);
    if (eventDate && eventDate !== '0000-00-00') {
      dates[eventDate] = `${formatTimeValue(row.event_start_time)} - ${formatTimeValue(row.event_end_time)}`;
    } else {
      tbc = true;
    }
  }

  const sorted = {};
  for (const key of Object.keys(dates).sort()) {
    sorted[key] = dates[key];
  }
  if (tbc) {
    sorted.TBC = '';
  }
  return sorted;
}

/** Port of Booking::timeAmPm */
function timeAmPm(t) {
  if (!t) return '';
  const parts = String(t).split('-');
  const formatPart = (part) => {
    const normalized = String(part).trim().replace(':', '.');
    const hour = Number(normalized);
    const display = String(part).trim().replace(/^0+/, '') || '0';
    return hour > 12 ? `${display}pm` : `${display}am`;
  };

  let ret = '';
  if (parts[0] != null) {
    ret += formatPart(parts[0]);
  }
  if (parts[1] != null) {
    ret += ` - ${formatPart(parts[1])}`;
  }
  return ret;
}

/** Port of Event::showDepositPrice */
function showDepositPrice(event) {
  if (
    !(Number(event.school_deposit_price) > 0) ||
    !(Number(event.is_deposit) > 0)
  ) {
    return false;
  }

  const dateKeys = Object.keys(event.dates || {}).filter((k) => k !== 'TBC');
  if (!dateKeys.length) {
    return false;
  }

  const firstDate = dateKeys.sort()[0];
  const depositPeriod = Number(event.deposit_days) || 0;
  const depositCalDate = new Date();
  depositCalDate.setDate(depositCalDate.getDate() + depositPeriod + 1);
  const depositCalStr = formatDateValue(depositCalDate);

  return depositCalStr > firstDate;
}

function vTypeSelectLabels() {
  return {
    '0': 'Manual',
    '1': 'Automatic',
    '3': 'I will be using my own vehicle',
  };
}

function tobLabels() {
  return {
    m: 'MOTO',
    o: 'Online',
    t: 'Terminal',
    w: 'Worldpay',
    r: 'RideTo',
  };
}

async function isFrozen(pool, courseEventId) {
  const [rows] = await pool.query(
    'SELECT id FROM freeze WHERE course_event_id = ? LIMIT 1',
    [Number(courseEventId)]
  );
  return rows.length > 0;
}

async function frozenData(pool, courseEventId) {
  const [rows] = await pool.query(
    'SELECT * FROM freeze WHERE course_event_id = ? LIMIT 1',
    [Number(courseEventId)]
  );
  return rows[0] || null;
}

async function getCourseEventRow(pool, evId) {
  const [rows] = await pool.query(
    `SELECT course_events.*, course_events.id AS ceId,
      courses.course_name, courses.description, courses.deposit_days,
      locations.location_name, locations.address1, locations.address2,
      locations.address3, locations.address4, locations.postcode,
      franchise.franchise_name
     FROM course_events
     LEFT JOIN courses ON courses.id = course_events.course_id
     LEFT JOIN locations ON locations.id = course_events.location_id
     LEFT JOIN franchise ON franchise.id = course_events.franchise_id
     WHERE course_events.id = ?
     LIMIT 1`,
    [Number(evId)]
  );
  return rows[0] || null;
}

async function getEvent(pool, evId, session) {
  const row = await getCourseEventRow(pool, evId);
  if (!row) {
    return null;
  }

  const [dateRows] = await pool.query(
    'SELECT * FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date ASC',
    [Number(evId)]
  );

  const dates = buildEventDates(dateRows);

  let manCountOld = 0;
  let autoCountOld = 0;
  const lockSession = session?.adminBooking?.lock_session;
  if (lockSession) {
    manCountOld = Number(lockSession.manual_lock) || 0;
    autoCountOld = Number(lockSession.automatic_lock) || 0;
  }

  const vTypeSelect = {};
  if (
    Number(row.vehicle_type_automatic) > 0 &&
    Number(row.vehicle_type_automatic) >
      Number(row.automatic_lock_done) - autoCountOld
  ) {
    vTypeSelect['1'] = 'Automatic';
  }
  if (
    Number(row.vehicle_type_manual) > 0 &&
    Number(row.vehicle_type_manual) > Number(row.manual_lock_done) - manCountOld
  ) {
    vTypeSelect['0'] = 'Manual';
  }
  if (Number(row.vehicle_type_own) === 1) {
    vTypeSelect['3'] = 'I will be using my own vehicle';
  }

  return {
    ...row,
    id: row.ceId,
    dates,
    vTypeSelect,
  };
}

function getCurrentSpaceRequired(session, evId) {
  const adminBooking = session?.adminBooking;
  if (
    adminBooking?.space_required != null &&
    String(adminBooking.eventId) === String(evId)
  ) {
    return Number(adminBooking.space_required) || 0;
  }
  return 0;
}

function computeSeatsAvailable(event, isFrozenFlag, currBookSeates, confirmedCount) {
  if (isFrozenFlag) {
    return 0;
  }
  const done =
    confirmedCount != null
      ? Number(confirmedCount) || 0
      : Math.max(0, Number(event.bookings_done) || 0);
  const raw =
    Number(event.booking_limit) - (done + Number(event.current_locks)) + currBookSeates;
  return raw < 0 ? 0 : raw;
}

function computeBookingInProcess(event, currBookSeates) {
  return Math.abs(Number(event.current_locks) - currBookSeates);
}

function computeConfirmedBookings(event, isFrozenFlag, frozenRow) {
  if (isFrozenFlag && frozenRow) {
    const done = Math.max(0, Number(frozenRow.bookings_done) || 0);
    const limit = Number(frozenRow.booking_limit) || 0;
    return done > limit ? limit : done;
  }
  const done = Math.max(0, Number(event.bookings_done) || 0);
  const limit = Number(event.booking_limit) || 0;
  return done > limit ? limit : done;
}

function mapBookingDisplayStatus(row) {
  if (Number(row.status) === 1 && Number(row.refundable) === 0) {
    return 'Confirmed';
  }
  if (Number(row.status) === 1 && Number(row.refundable) === 1) {
    return 'Over Booking';
  }
  return 'In Process';
}

function shouldSkipBookingRow(row) {
  if (Number(row.status) !== 0) {
    return false;
  }
  const created = new Date(row.created).getTime();
  if (Number.isNaN(created)) {
    return false;
  }
  return Date.now() > created + 2 * 3600 * 1000;
}

async function getEventBookings(pool, evId, page = 1) {
  const perPage = 10;
  const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const offset = (safePage - 1) * perPage;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM bookings
     WHERE course_event_id = ? AND bookings.status = 1`,
    [Number(evId)]
  );
  const total = Number(countRows[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT bookings.total_amount, bookings.payment_due, bookings.refundable,
      booking_attendees.booking_ref, booking_attendees.first_name, booking_attendees.sur_name,
      bookings.type_of_book, bookings.spaces, bookings.status, bookings.created,
      bookings.id, booking_attendees.booking_id, booking_attendees.vehicle_type
     FROM bookings
     LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     WHERE bookings.course_event_id = ? AND bookings.status = 1
     ORDER BY booking_attendees.booking_id, booking_attendees.\`primary\` DESC
     LIMIT ? OFFSET ?`,
    [Number(evId), perPage, offset]
  );

  const bookings = (rows || [])
    .filter((row) => !shouldSkipBookingRow(row))
    .map((row) => ({
      id: row.id,
      booking_id: row.booking_id,
      booking_ref: row.booking_ref || `1SRC${row.id}`,
      first_name: row.first_name,
      sur_name: row.sur_name,
      attendee_name: `${trim(row.first_name)} ${trim(row.sur_name)}`.trim(),
      type_of_book: row.type_of_book,
      vehicle_type: row.vehicle_type != null ? String(row.vehicle_type) : '',
      spaces: 1,
      status: Number(row.status),
      refundable: Number(row.refundable),
      display_status: mapBookingDisplayStatus(row),
      created: row.created,
      total_amount: Number(row.total_amount) || 0,
      payment_due: Number(row.payment_due) || 0,
    }));

  return {
    rows: bookings,
    pagination: {
      page: safePage,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    },
  };
}

async function getLockBooking(pool, lockId) {
  const [rows] = await pool.query('SELECT * FROM lock_bookings WHERE id = ? LIMIT 1', [
    Number(lockId),
  ]);
  return rows[0] || null;
}

async function resolveLockUserLabel(pool, lockRow) {
  if (lockRow.locked_by === 'ride2') {
    return 'RideTo';
  }
  if (Number(lockRow.user_id) === 0) {
    return 'Guest';
  }
  if (Number(lockRow.user_id) === -1) {
    return 'Admin';
  }
  if (lockRow.locked_by === 'terminal') {
    const [rows] = await pool.query(
      `SELECT CONCAT('Admin (', COALESCE(admin_fristname, ''), ' ',
        COALESCE(admin_lastname, ''), ')') AS adminuser
       FROM admin WHERE admin_id = ? LIMIT 1`,
      [Number(lockRow.user_id)]
    );
    const label = trim(rows[0]?.adminuser);
    if (label && label !== 'Admin ( )' && label !== 'Admin ()') {
      return label;
    }
    return 'Admin';
  }
  const [rows] = await pool.query(
    'SELECT first_name, sur_name FROM users WHERE id = ? LIMIT 1',
    [Number(lockRow.user_id)]
  );
  if (!rows[0]) return 'Guest';
  return `${trim(rows[0].first_name)} ${trim(rows[0].sur_name)}`.trim();
}

async function getProcessLocks(pool, evId) {
  const [eventRows] = await pool.query(
    'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
    [Number(evId)]
  );
  const parentId = eventRows[0]?.parent ?? Number(evId);

  const [rows] = await pool.query(
    `SELECT id, space_required, payment_page_stauts, user_id, locked_by
     FROM lock_bookings
     WHERE delete_process = 0
       AND (event_id = ? OR parent = ?)`,
    [Number(evId), parentId]
  );

  const locks = [];
  for (const row of rows || []) {
    locks.push({
      id: row.id,
      space_required: Number(row.space_required) || 0,
      payment_page_stauts: Number(row.payment_page_stauts) || 0,
      payment_stage_reached: Number(row.payment_page_stauts) === 1 ? 'Yes' : 'No',
      user_label: await resolveLockUserLabel(pool, row),
      locked_by: row.locked_by,
      can_delete:
        row.locked_by !== 'ride2' && Number(row.user_id) !== -1,
    });
  }
  return locks;
}

function syncAdminBookingSession(req, evId, courseId) {
  if (!req.session.adminBooking) {
    req.session.adminBooking = {};
  }
  req.session.adminBooking.eventId = trim(evId);
  req.session.adminBooking.courseId = trim(courseId);
}

function buildLockTimer(session) {
  const countdown = session?.adminBooking?.lock_countdown;
  if (!countdown) {
    return null;
  }
  const expiresAt = Number(countdown) + LOCK_EXPIRE_TIME_MINUTES * 60;
  const remaining = expiresAt - Math.floor(Date.now() / 1000);
  if (remaining <= 0) {
    return { expired: true, expiresAt, remainingSeconds: 0 };
  }
  return { expired: false, expiresAt, remainingSeconds: remaining };
}

async function loadBookingDetails(pool, req, evId, page) {
  await removeExpirelocks(pool, req.session);

  const eventRow = await getCourseEventRow(pool, evId);
  if (!eventRow) {
    return { ok: false, message: 'Invalid course, Try again' };
  }

  await updateApiEventCourse(pool, evId);
  syncAdminBookingSession(req, evId, eventRow.course_id);

  const event = await getEvent(pool, evId, req.session);
  const frozenFlag = await isFrozen(pool, evId);
  const frozenRow = frozenFlag ? await frozenData(pool, evId) : null;
  const currBookSeates = getCurrentSpaceRequired(req.session, evId);
  const bookings = await getEventBookings(pool, evId, page);
  // Match Confirmed Bookings table: count live status=1 rows, not bookings_done counter
  // (counter can drift negative after move/delete — e.g. event 21611 showing -1).
  const confirmedBookings = bookings.pagination.total;
  const seatsAvailable = computeSeatsAvailable(
    event,
    frozenFlag,
    currBookSeates,
    confirmedBookings
  );
  const bookingInProcess = computeBookingInProcess(event, currBookSeates);
  const processLocks = await getProcessLocks(pool, evId);
  const showDepositWarning = showDepositPrice(event);
  const lockTimer = buildLockTimer(req.session);

  const dateKeys = Object.keys(event.dates || {}).filter((k) => k !== 'TBC');
  const firstDate = dateKeys.sort()[0] || null;

  return {
    ok: true,
    data: {
      event: {
        id: Number(event.id),
        course_id: Number(event.course_id),
        course_name: event.course_name,
        description: event.description || '',
        dates: event.dates,
        first_date: firstDate,
        multi_day: dateKeys.length > 1,
        location_name: event.location_name,
        address1: event.address1,
        address2: event.address2,
        address3: event.address3,
        address4: event.address4,
        postcode: event.postcode,
        franchise_name: event.franchise_name,
        booking_limit: Number(event.booking_limit) || 0,
        bookings_done: Number(event.bookings_done) || 0,
        current_locks: Number(event.current_locks) || 0,
        school_one_off_price: Number(event.school_one_off_price) || 0,
        school_deposit_price: Number(event.school_deposit_price) || 0,
        school_total_price: Number(event.school_total_price) || 0,
        own_one_off_price: Number(event.own_one_off_price) || 0,
        own_deposit_price: Number(event.own_deposit_price) || 0,
        own_total_price: Number(event.own_total_price) || 0,
        vehicle_type_manual: Number(event.vehicle_type_manual) || 0,
        vehicle_type_automatic: Number(event.vehicle_type_automatic) || 0,
        vehicle_type_own: Number(event.vehicle_type_own) || 0,
        is_deposit: Number(event.is_deposit) || 0,
      },
      isFrozen: frozenFlag,
      frozenData: frozenRow,
      confirmedBookings,
      seatsAvailable,
      bookingInProcess,
      showDepositWarning,
      currentSpaceRequired: currBookSeates,
      adminBooking: {
        eventId: req.session.adminBooking?.eventId,
        courseId: req.session.adminBooking?.courseId,
        space_required: currBookSeates,
        lock_session: req.session.adminBooking?.lock_session || null,
        lock_countdown: req.session.adminBooking?.lock_countdown || null,
        lockTimer,
      },
      processLocks,
      bookings,
      vTypeSelect: vTypeSelectLabels(),
      tob: tobLabels(),
    },
  };
}

async function lockBooking(pool, req, evId, spaceRequired, adminId) {
  const event = await getEvent(pool, evId, req.session);
  if (!event) {
    return { ok: false, message: 'Invalid course, Try again' };
  }

  const currBookSeates = Number(spaceRequired);
  if (!Number.isFinite(currBookSeates) || currBookSeates <= 0) {
    return { ok: false, message: 'Please select how many spaces you require' };
  }

  let spAvail =
    Number(event.booking_limit) -
    Number(event.bookings_done) -
    Number(event.current_locks);

  if (req.session?.adminBooking?.space_required != null) {
    spAvail += Number(req.session.adminBooking.space_required) || 0;
  }

  if (spAvail < currBookSeates) {
    await updateApiEventCourse(pool, evId);
    return {
      ok: false,
      message: `${currBookSeates} booking are not available only ${spAvail} available please continue with ${spAvail} bookings.`,
      redirect: '/admin/dashboard',
    };
  }

  req.session.adminBooking = req.session.adminBooking || {};
  req.session.adminBooking.eventId = trim(evId);
  req.session.adminBooking.courseId = trim(event.course_id);
  req.session.adminBooking.space_required = currBookSeates;

  let lockBookingId = 0;
  const existingLock = req.session.adminBooking.lock_session;
  if (existingLock?.id) {
    const lockExists = await getLockBooking(pool, existingLock.id);
    if (lockExists) {
      const [parentEvents] = await pool.query(
        'SELECT id FROM course_events WHERE parent = ?',
        [lockExists.parent]
      );
      for (const edata of parentEvents) {
        await pool.query(
          'UPDATE course_events SET current_locks = current_locks - ? WHERE id = ? AND current_locks > 0',
          [lockExists.space_required, edata.id]
        );
      }
      lockBookingId = lockExists.id;
    }
  } else {
    req.session.adminBooking.lock_countdown = Math.floor(Date.now() / 1000);
  }

  const [parentEvents] = await pool.query(
    'SELECT id, parent FROM course_events WHERE parent = (SELECT parent FROM course_events WHERE id = ?)',
    [Number(evId)]
  );

  if (!parentEvents.length) {
    return { ok: false, message: 'Invalid course, Try again' };
  }

  const parentId = parentEvents[0].parent;
  const now = formatTimestamp();

  let lock;
  if (lockBookingId) {
    await pool.query(
      `UPDATE lock_bookings
       SET event_id = ?, parent = ?, space_required = ?, modified = ?, locked_by = ?
       WHERE id = ?`,
      [evId, parentId, currBookSeates, now, 'terminal', lockBookingId]
    );
    lock = await getLockBooking(pool, lockBookingId);
  } else {
    const [result] = await pool.query(
      `INSERT INTO lock_bookings
       (event_id, parent, space_required, created, modified, user_id, payment_page_stauts, locked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [evId, parentId, currBookSeates, now, now, adminId, 1, 'terminal']
    );
    lock = await getLockBooking(pool, result.insertId);
  }

  for (const edata of parentEvents) {
    await pool.query(
      'UPDATE course_events SET current_locks = current_locks + ? WHERE id = ?',
      [currBookSeates, edata.id]
    );
  }

  if (lock) {
    req.session.adminBooking.lock_session = lock;
  }

  await updateApiEventCourse(pool, evId);

  return {
    ok: true,
    redirect: '/admin/bookings/new',
    lock,
  };
}

async function removeCurLock(pool, session, lockId = null, notBooking = true) {
  let lockData = null;
  if (lockId == null && session?.adminBooking?.lock_session) {
    lockData = session.adminBooking.lock_session;
  } else if (lockId) {
    lockData = await getLockBooking(pool, lockId);
  }

  if (!lockData?.id) {
    return false;
  }

  const [deleteResult] = await pool.query('DELETE FROM lock_bookings WHERE id = ?', [
    lockData.id,
  ]);

  if (!deleteResult?.affectedRows) {
    return false;
  }

  const [eventsData] = await pool.query(
    'SELECT * FROM course_events WHERE parent = ?',
    [lockData.parent]
  );

  for (const edata of eventsData) {
    if (notBooking) {
      let svM = edata.manual_lock_done;
      if (lockData.manual_lock) {
        svM = Number(edata.manual_lock_done) - Number(lockData.manual_lock);
      }
      const svA = Number(edata.automatic_lock_done) - Number(lockData.automatic_lock || 0);
      await pool.query(
        'UPDATE course_events SET manual_lock_done = ?, automatic_lock_done = ? WHERE id = ?',
        [svM, svA, edata.id]
      );
    }
    await pool.query(
      'UPDATE course_events SET current_locks = current_locks - ? WHERE id = ? AND current_locks > 0',
      [lockData.space_required, edata.id]
    );
  }

  return true;
}

function clearAdminBookingSessionKeys(session) {
  if (!session) {
    return;
  }
  delete session.adminBooking;
  delete session.preFillData;
  delete session.courseEvent;
  delete session.worldPaymentBookings;
  delete session.motoPaymentBookings;
  delete session.adminMotoStripe;
  delete session.adminOriginalAmount;
  delete session.blacklisted;
}

async function deleteAbandonedInProgressBookings(pool, req) {
  const bookingIds = [
    ...(req.session?.worldPaymentBookings || []),
    ...(req.session?.motoPaymentBookings || []),
  ]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!bookingIds.length) {
    return;
  }

  for (const bookingId of bookingIds) {
    const [rows] = await pool.query('SELECT status FROM bookings WHERE id = ? LIMIT 1', [
      bookingId,
    ]);
    if (!rows[0] || Number(rows[0].status) !== 0) {
      continue;
    }
    await pool.query('DELETE FROM booking_attendees WHERE booking_id = ?', [bookingId]);
    await pool.query('DELETE FROM booking_payments WHERE booking_id = ?', [bookingId]);
    await pool.query('DELETE FROM bookings WHERE id = ? AND status = 0', [bookingId]);
  }
}

/** Release terminal lock, drop in-progress bookings, clear admin booking session. */
async function abandonAdminBookingSession(pool, req) {
  await deleteAbandonedInProgressBookings(pool, req);
  await removeCurLock(pool, req.session);
  clearAdminBookingSessionKeys(req.session);
  return {
    ok: true,
    redirect: '/admin/dashboard',
  };
}

async function endCounterLock(pool, req) {
  await abandonAdminBookingSession(pool, req);
  return {
    ok: true,
    message: 'Your session has been timed out and your booking has been cancelled',
    redirect: '/admin/dashboard',
  };
}

async function removeProcessCurLock(pool, lockId) {
  const lockData = await getLockBooking(pool, lockId);
  if (!lockData?.id) {
    return false;
  }

  const [updateResult] = await pool.query(
    'UPDATE lock_bookings SET delete_process = 1 WHERE id = ?',
    [lockData.id]
  );

  if (!updateResult?.affectedRows) {
    return false;
  }

  const [eventsData] = await pool.query(
    'SELECT * FROM course_events WHERE parent = ?',
    [lockData.parent]
  );

  for (const edata of eventsData) {
    let svM = edata.manual_lock_done;
    if (lockData.manual_lock) {
      svM = Number(edata.manual_lock_done) - Number(lockData.manual_lock);
    }
    const svA = Number(edata.automatic_lock_done) - Number(lockData.automatic_lock || 0);
    await pool.query(
      'UPDATE course_events SET manual_lock_done = ?, automatic_lock_done = ? WHERE id = ?',
      [svM, svA, edata.id]
    );
    await pool.query(
      'UPDATE course_events SET current_locks = current_locks - ? WHERE id = ? AND current_locks > 0',
      [lockData.space_required, edata.id]
    );
  }

  await pool.query('DELETE FROM lock_bookings WHERE id = ?', [lockData.id]);
  return true;
}

function parseEventTimeRange(timeRange) {
  const parts = String(timeRange || '')
    .split('-')
    .map((part) => part.trim());
  const start = parts[0] || '00:00';
  const end = parts[1] || start;
  return { s: start, e: end };
}

/**
 * Port of ajaxFile setFreeze — freeze=1 (Day Frozen), freeze=2 (Day Active)
 */
async function setEventFreeze(pool, eventId, dates, freeze) {
  const freezeValue = Number(freeze);
  if (![1, 2].includes(freezeValue)) {
    return { ok: false, message: 'Invalid freeze status' };
  }

  const eventRow = await getCourseEventRow(pool, eventId);
  if (!eventRow) {
    return { ok: false, message: 'Invalid course, Try again' };
  }

  let dateMap = dates && typeof dates === 'object' ? dates : {};
  if (!Object.keys(dateMap).length) {
    const [dateRows] = await pool.query(
      `SELECT event_date, event_start_time, event_end_time
       FROM course_event_dates WHERE course_event_id = ?`,
      [Number(eventId)]
    );
    dateMap = buildEventDates(dateRows);
  }

  for (const [ceDate, timeRange] of Object.entries(dateMap)) {
    if (ceDate === 'TBC') {
      await setSingleFrozenDate(pool, eventId, ceDate, '', '', freezeValue);
      continue;
    }
    const { s, e } = parseEventTimeRange(timeRange);
    await setSingleFrozenDate(pool, eventId, ceDate, s, e, freezeValue);
  }

  if (freezeValue === 1) {
    await freezeApiEventCourse(pool, eventRow.parent || eventId);
  } else {
    await freezeApiEventCourse(pool, eventId);
  }

  return {
    ok: true,
    message: `Course event ${freezeValue === 1 ? 'Freezed' : 'Unfreezed'} successfully`,
  };
}

module.exports = {
  loadBookingDetails,
  lockBooking,
  endCounterLock,
  abandonAdminBookingSession,
  clearAdminBookingSessionKeys,
  removeProcessCurLock,
  removeCurLock,
  setEventFreeze,
  timeAmPm,
  showDepositPrice,
  getEvent,
  getLockBooking,
  buildLockTimer,
  getCourseEventRow,
  buildEventDates,
};
