const { removeExpirelocks } = require('./bookingService');
const { isEventFrozen } = require('./courseEventWizardService');
const { isStripePaymentLinkLockedBy } = require('../constants');

const TOB_LABELS = {
  m: 'MOTO',
  o: 'Online',
  t: 'Terminal',
  w: 'Worldpay',
  r: 'RideTo',
};

const VEHICLE_TYPE_LABELS = {
  0: 'Manual',
  1: 'Automatic',
  3: 'I will be using my own vehicle',
};

const TBC_DATE = '0000-00-00';

function ensureAdminBookingSession(session) {
  if (!session) return null;
  if (!session.adminBooking) session.adminBooking = {};
  return session.adminBooking;
}

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/** Normalize mysql DATE / Date / string values to YYYY-MM-DD (or TBC). */
function toDateKey(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${d}`;
    return key === TBC_DATE || y < 1900 ? 'TBC' : key;
  }

  const raw = trim(value);
  if (!raw || raw === 'TBC') return raw === 'TBC' ? 'TBC' : '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const key = raw.slice(0, 10);
    return key === TBC_DATE ? 'TBC' : key;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return toDateKey(parsed);
  }
  return raw;
}

function formatTimeAmPm(timeRange) {
  if (!timeRange) return '';
  const parts = String(timeRange).split('-');
  const formatOne = (t) => {
    const raw = trim(t);
    if (!raw) return '';
    const num = Number(raw.replace(':', '.'));
    const hourPart = trim(raw).replace(/^0+/, '') || '0';
    if (Number.isNaN(num)) return raw;
    return num > 12 ? `${hourPart}pm` : `${hourPart}am`;
  };
  const one = formatOne(parts[0]);
  const two = parts[1] ? formatOne(parts[1]) : '';
  return two ? `${one} - ${two}` : one;
}

function formatBookingCreated(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  const hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(h12)}:${pad(d.getMinutes())} ${ampm}`;
}

function formatLongDate(value) {
  if (!value || value === TBC_DATE || value === 'TBC') return 'TBC';
  const key = toDateKey(value);
  if (!key || key === 'TBC') return 'TBC';
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
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

function buildEventDatesMap(dateRows) {
  const dates = {};
  let hasTbc = false;
  for (const row of dateRows || []) {
    const key = toDateKey(row.event_date);
    if (key && key !== 'TBC') {
      dates[key] = `${row.event_start_time || ''} - ${row.event_end_time || ''}`;
    } else {
      hasTbc = true;
    }
  }
  const sorted = Object.fromEntries(
    Object.entries(dates).sort(([a], [b]) => a.localeCompare(b))
  );
  if (hasTbc) sorted.TBC = '';
  return sorted;
}

function showDepositCancellationWarning(event, dates) {
  const schoolDeposit = Number(event.school_deposit_price) || 0;
  const isDeposit = Number(event.is_deposit) || 0;
  if (!(schoolDeposit > 0 && isDeposit > 0)) return false;

  const keys = Object.keys(dates || {}).filter((k) => k !== 'TBC');
  if (!keys.length) return false;

  const firstDate = keys.sort()[0];
  const depositPeriod =
    Number(event.deposit_days ?? event.cancel_days ?? 0) || 0;
  const depositCalDate = new Date();
  depositCalDate.setDate(depositCalDate.getDate() + depositPeriod + 1);
  const depositCalYmd = depositCalDate.toISOString().slice(0, 10);
  return depositCalYmd > firstDate;
}

function deriveBookingDisplayStatus(booking) {
  if (Number(booking.status) === 1 && Number(booking.refundable) === 0) {
    return 'Confirmed';
  }
  if (Number(booking.status) === 1 && Number(booking.refundable) === 1) {
    return 'Over Booking';
  }
  return 'In Process';
}

function computeSpacesAvailable(event, isFrozen, currentSpaceSelection) {
  const bookingLimit = Number(event.booking_limit) || 0;
  const bookingsDone = Number(event.bookings_done) || 0;
  const currentLocks = Number(event.current_locks) || 0;
  const selected = Number(currentSpaceSelection) || 0;

  if (isFrozen) return 0;

  const raw = bookingLimit - (bookingsDone + currentLocks) + selected;
  return raw < 0 ? 0 : raw;
}

function computeConfirmedBookings(event, frozenData, isFrozen) {
  const bookingLimit = Number(
    isFrozen ? frozenData?.booking_limit : event.booking_limit
  ) || 0;
  const bookingsDone = Number(
    isFrozen ? frozenData?.bookings_done : event.bookings_done
  ) || 0;
  return bookingsDone > bookingLimit ? bookingLimit : bookingsDone;
}

async function getFrozenData(pool, eventId) {
  const [rows] = await pool.query(
    'SELECT * FROM freeze WHERE course_event_id = ? LIMIT 1',
    [eventId]
  );
  return rows?.[0] || null;
}

async function getEventRow(pool, evId) {
  const [rows] = await pool.query(
    `SELECT course_events.*,
            course_events.id AS ceId,
            courses.course_name,
            courses.description,
            courses.deposit_days,
            courses.cancel_days,
            locations.location_name,
            locations.address1,
            locations.address2,
            locations.address3,
            locations.address4,
            locations.postcode,
            franchise.franchise_name
     FROM course_events
     LEFT JOIN courses ON courses.id = course_events.course_id
     LEFT JOIN locations ON locations.id = course_events.location_id
     LEFT JOIN franchise ON franchise.id = course_events.franchise_id
     WHERE course_events.id = ?
     LIMIT 1`,
    [evId]
  );
  return rows?.[0] || null;
}

async function resolveLockUserLabel(pool, lock) {
  if (lock.locked_by === 'ride2') return 'RideTo';
  if (Number(lock.user_id) === 0) return 'Guest';
  if (Number(lock.user_id) === -1) return 'Admin';

  if (lock.locked_by === 'terminal' || isStripePaymentLinkLockedBy(lock.locked_by)) {
    const [rows] = await pool.query(
      `SELECT CONCAT('Admin (', admin_fristname, ' ', admin_lastname, ')') AS adminuser
       FROM admin WHERE admin_id = ? LIMIT 1`,
      [lock.user_id]
    );
    return rows?.[0]?.adminuser || `Admin (${lock.user_id})`;
  }

  const [rows] = await pool.query(
    'SELECT first_name, sur_name FROM users WHERE id = ? LIMIT 1',
    [lock.user_id]
  );
  const user = rows?.[0];
  return user ? `${user.first_name} ${user.sur_name}`.trim() : `User ${lock.user_id}`;
}

async function getEventBookingPage(pool, evId, session) {
  await removeExpirelocks(pool, session);

  const eventId = Number(evId);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    const err = new Error('Invalid course, Try again');
    err.status = 404;
    throw err;
  }

  const event = await getEventRow(pool, eventId);
  if (!event) {
    const err = new Error('Invalid course, Try again');
    err.status = 404;
    throw err;
  }

  const adminBooking = ensureAdminBookingSession(session);
  if (adminBooking) {
    adminBooking.eventId = eventId;
    adminBooking.courseId = event.course_id;
  }

  let currentSpaceSelection = 0;
  if (
    adminBooking &&
    Number(adminBooking.eventId) === eventId &&
    adminBooking.space_required
  ) {
    currentSpaceSelection = Number(adminBooking.space_required) || 0;
  }

  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates
     WHERE course_event_id = ?
     ORDER BY event_date ASC`,
    [eventId]
  );
  const dates = buildEventDatesMap(dateRows);

  const frozen = await getFrozenData(pool, eventId);
  const isFrozen = Boolean(frozen);

  const [lockRows] = await pool.query(
    `SELECT id, space_required, payment_page_stauts, user_id, locked_by
     FROM lock_bookings
     WHERE event_id = ? AND delete_process = 0`,
    [eventId]
  );

  const locks = [];
  for (const lock of lockRows || []) {
    locks.push({
      id: lock.id,
      space_required: Number(lock.space_required) || 0,
      payment_page_reached: Number(lock.payment_page_stauts) === 1,
      user_label: await resolveLockUserLabel(pool, lock),
      can_delete:
        lock.locked_by !== 'ride2' &&
        !isStripePaymentLinkLockedBy(lock.locked_by) &&
        Number(lock.user_id) !== -1,
    });
  }

  const [bookingRows] = await pool.query(
    `SELECT total_amount, payment_due, refundable, booking_ref,
            first_name, sur_name, type_of_book, spaces, status,
            bookings.created, bookings.id, booking_id, vehicle_type
     FROM bookings
     LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     WHERE course_event_id = ? AND bookings.status = 1
     ORDER BY booking_id, \`primary\` DESC`,
    [eventId]
  );

  const nowMs = Date.now();
  const bookings = [];
  for (const row of bookingRows || []) {
    if (Number(row.status) === 0) {
      const createdMs = new Date(row.created).getTime();
      if (!Number.isNaN(createdMs) && nowMs > createdMs + 2 * 3600 * 1000) {
        continue;
      }
    }

    const vehicleKey = String(row.vehicle_type ?? '');
    bookings.push({
      id: row.id,
      booking_ref: row.booking_ref,
      attendee_name: `${row.first_name || ''} ${row.sur_name || ''}`.trim(),
      type_of_book: row.type_of_book,
      type_of_book_label: TOB_LABELS[row.type_of_book] || row.type_of_book,
      vehicle_type: row.vehicle_type,
      vehicle_type_label:
        VEHICLE_TYPE_LABELS[row.vehicle_type] ||
        VEHICLE_TYPE_LABELS[vehicleKey] ||
        '',
      spaces: 1,
      status: Number(row.status),
      refundable: Number(row.refundable),
      display_status: deriveBookingDisplayStatus(row),
      created: row.created,
      created_label: formatBookingCreated(row.created),
      total_amount: row.total_amount,
      payment_due: row.payment_due,
      can_edit:
        Number(row.status) === 1 && Number(row.refundable) === 0,
      can_refund: Number(row.refundable) === 1,
      can_delete:
        Number(row.status) === 1 && Number(row.refundable) === 0,
    });
  }

  const dateEntries = Object.entries(dates).map(([dateKey, timeRange], index) => ({
    day_number: index + 1,
    date_key: dateKey,
    date_label: dateKey === 'TBC' ? 'TBC' : formatLongDate(dateKey),
    time_label: formatTimeAmPm(timeRange),
    is_tbc: dateKey === 'TBC',
  }));

  const firstDateKey = Object.keys(dates).find((k) => k !== 'TBC') || null;
  const spacesAvailable = computeSpacesAvailable(
    event,
    isFrozen,
    currentSpaceSelection
  );
  const bookingInProcess = Math.abs(
    Number(event.current_locks || 0) - currentSpaceSelection
  );

  return {
    event: {
      id: event.ceId,
      course_id: event.course_id,
      course_name: event.course_name || '',
      description: event.description || '',
      location_id: Number(event.location_id) || 0,
      location_name: event.location_name || '',
      address1: event.address1 || '',
      address2: event.address2 || '',
      address3: event.address3 || '',
      address4: event.address4 || '',
      postcode: event.postcode || '',
      franchise_name: event.franchise_name || '',
      booking_limit: Number(event.booking_limit) || 0,
      bookings_done: Number(event.bookings_done) || 0,
      current_locks: Number(event.current_locks) || 0,
      vehicle_type_manual: Number(event.vehicle_type_manual) || 0,
      vehicle_type_automatic: Number(event.vehicle_type_automatic) || 0,
      vehicle_type_own: Number(event.vehicle_type_own) || 0,
      school_one_off_price: Number(event.school_one_off_price) || 0,
      school_deposit_price: Number(event.school_deposit_price) || 0,
      school_total_price: Number(event.school_total_price) || 0,
      own_one_off_price: Number(event.own_one_off_price) || 0,
      own_deposit_price: Number(event.own_deposit_price) || 0,
      own_total_price: Number(event.own_total_price) || 0,
      is_deposit: Number(event.is_deposit) || 0,
      deposit_days: Number(event.deposit_days ?? event.cancel_days ?? 0) || 0,
      dates,
      date_entries: dateEntries,
      first_date_label: firstDateKey ? formatLongDate(firstDateKey) : 'TBC',
      is_multi_day: dateEntries.filter((d) => !d.is_tbc).length > 1,
    },
    is_frozen: isFrozen,
    frozen_data: frozen,
    confirmed_bookings: computeConfirmedBookings(event, frozen, isFrozen),
    show_deposit_cancellation_warning: showDepositCancellationWarning(
      event,
      dates
    ),
    spaces_available: spacesAvailable,
    booking_in_process: bookingInProcess,
    current_space_selection: currentSpaceSelection,
    space_options: Array.from({ length: spacesAvailable }, (_, i) => i + 1),
    locks,
    bookings,
    vehicle_type_labels: VEHICLE_TYPE_LABELS,
    tob_labels: TOB_LABELS,
  };
}

async function lockEventSeats(pool, evId, spaceRequired, session, adminId) {
  await removeExpirelocks(pool, session);

  const eventId = Number(evId);
  const spaces = Number(spaceRequired);
  if (!Number.isFinite(eventId) || eventId <= 0 || !Number.isFinite(spaces) || spaces <= 0) {
    const err = new Error('Please select how many spaces you require');
    err.status = 400;
    throw err;
  }

  const page = await getEventBookingPage(pool, eventId, session);
  const adminBooking = ensureAdminBookingSession(session);
  let available = page.spaces_available;
  if (adminBooking?.space_required) {
    available += Number(adminBooking.space_required) || 0;
  }

  if (available < spaces) {
    const err = new Error(
      `${spaces} booking are not available only ${available} available please continue with ${available} bookings.`
    );
    err.status = 400;
    throw err;
  }

  const [parentRows] = await pool.query(
    'SELECT id, parent FROM course_events WHERE parent = (SELECT parent FROM course_events WHERE id = ?)',
    [eventId]
  );
  const linkedEvents = parentRows || [];
  if (!linkedEvents.length) {
    const err = new Error('Invalid course, Try again');
    err.status = 404;
    throw err;
  }

  const parentId = linkedEvents[0].parent;
  let lockId = 0;
  let previousSpaces = 0;
  const adminBookingSession = adminBooking || {};
  const resolvedAdminId = Number(adminId) || 0;
  const mutexName = `admin_event_lock_${resolvedAdminId}_${parentId}`;

  // Serialize concurrent Take booking / resize requests for the same admin+event.
  await pool.query('SELECT GET_LOCK(?, 10)', [mutexName]);

  try {
    if (!adminBookingSession.lock_session?.id && session) {
      session.adminBooking = session.adminBooking || {};
      session.adminBooking.lock_countdown = Math.floor(Date.now() / 1000);
    }

    if (adminBookingSession.lock_session?.id) {
      const existingId = Number(adminBookingSession.lock_session.id);
      const [existingRows] = await pool.query(
        'SELECT * FROM lock_bookings WHERE id = ? AND delete_process = 0 LIMIT 1',
        [existingId]
      );
      if (existingRows?.[0]) {
        lockId = existingId;
        previousSpaces = Number(existingRows[0].space_required) || 0;
      } else {
        delete adminBookingSession.lock_session;
      }
    }

    // Reuse an in-progress lock for this admin/event if session was not ready yet
    // (e.g. React Strict Mode / duplicate Take booking requests).
    if (!lockId && resolvedAdminId > 0) {
      const [existingByUser] = await pool.query(
        `SELECT * FROM lock_bookings
         WHERE delete_process = 0
           AND user_id = ?
           AND (event_id = ? OR parent = ?)
         ORDER BY id DESC
         LIMIT 1`,
        [resolvedAdminId, eventId, parentId]
      );
      if (existingByUser?.[0]) {
        lockId = Number(existingByUser[0].id);
        previousSpaces = Number(existingByUser[0].space_required) || 0;
      }
    }

    if (lockId && previousSpaces > 0) {
      // Release seats from the lock's current event group (may differ when changing date).
      const [oldLockRows] = await pool.query(
        'SELECT event_id, parent FROM lock_bookings WHERE id = ? LIMIT 1',
        [lockId]
      );
      const oldLock = oldLockRows?.[0];
      const oldParentId = Number(oldLock?.parent) || 0;
      let oldLinked = linkedEvents;
      if (oldParentId && oldParentId !== parentId) {
        const [oldParentRows] = await pool.query(
          'SELECT id, parent FROM course_events WHERE parent = ?',
          [oldParentId]
        );
        oldLinked = oldParentRows || [];
      } else if (!oldParentId && Number(oldLock?.event_id) > 0) {
        oldLinked = [{ id: Number(oldLock.event_id), parent: 0 }];
      }

      for (const edata of oldLinked) {
        await pool.query(
          `UPDATE course_events
           SET current_locks = GREATEST(0, current_locks - ?)
           WHERE id = ?`,
          [previousSpaces, edata.id]
        );
      }
    }

    if (lockId) {
      await pool.query(
        `UPDATE lock_bookings
         SET event_id = ?, parent = ?, space_required = ?, modified = NOW(), locked_by = ?
         WHERE id = ?`,
        [eventId, parentId, spaces, 'terminal', lockId]
      );
    } else {
      const [insertResult] = await pool.query(
        `INSERT INTO lock_bookings
          (event_id, parent, space_required, created, modified, user_id, payment_page_stauts, locked_by)
         VALUES (?, ?, ?, NOW(), NOW(), ?, 1, 'terminal')`,
        [eventId, parentId, spaces, resolvedAdminId]
      );
      lockId = insertResult.insertId;
    }

    if (!lockId) {
      const err = new Error('Unable to create booking lock');
      err.status = 500;
      throw err;
    }

    for (const edata of linkedEvents) {
      await pool.query(
        'UPDATE course_events SET current_locks = current_locks + ? WHERE id = ?',
        [spaces, edata.id]
      );
    }

    const [lockRows] = await pool.query(
      'SELECT * FROM lock_bookings WHERE id = ? LIMIT 1',
      [lockId]
    );
    const lock = lockRows?.[0];
    if (!lock) {
      const err = new Error('Unable to create booking lock');
      err.status = 500;
      throw err;
    }
    if (session) {
      session.adminBooking = session.adminBooking || {};
      session.adminBooking.eventId = eventId;
      session.adminBooking.space_required = spaces;
      session.adminBooking.courseId =
        page.event?.course_id || adminBookingSession.courseId;
      session.adminBooking.lock_session = lock;
    }

    return {
      lock_id: lockId,
      space_required: spaces,
      next_url: `/admin/bookings/new`,
    };
  } finally {
    await pool.query('SELECT RELEASE_LOCK(?)', [mutexName]);
  }
}

async function removeProcessLock(pool, lockId, session) {
  const id = Number(lockId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('Invalid lock');
    err.status = 400;
    throw err;
  }

  const [lockRows] = await pool.query(
    'SELECT * FROM lock_bookings WHERE id = ? LIMIT 1',
    [id]
  );
  const lock = lockRows?.[0];
  if (!lock) {
    const err = new Error('Lock not found');
    err.status = 404;
    throw err;
  }
  if (isStripePaymentLinkLockedBy(lock.locked_by)) {
    const err = new Error(
      'This space is held for a Stripe payment link and cannot be released until payment or expiry'
    );
    err.status = 400;
    throw err;
  }

  await pool.query(
    'UPDATE lock_bookings SET delete_process = 1 WHERE id = ?',
    [id]
  );

  const [eventsData] = await pool.query(
    'SELECT * FROM course_events WHERE parent = ?',
    [lock.parent]
  );

  for (const edata of eventsData || []) {
    const svM =
      Number(edata.manual_lock_done || 0) - Number(lock.manual_lock || 0);
    const svA =
      Number(edata.automatic_lock_done || 0) - Number(lock.automatic_lock || 0);
    await pool.query(
      'UPDATE course_events SET manual_lock_done = ?, automatic_lock_done = ? WHERE id = ?',
      [svM, svA, edata.id]
    );
    await pool.query(
      'UPDATE course_events SET current_locks = current_locks - ? WHERE id = ? AND current_locks > 0',
      [lock.space_required, edata.id]
    );
  }

  await pool.query('DELETE FROM lock_bookings WHERE id = ?', [id]);

  if (
    session?.adminBooking?.lock_session &&
    Number(session.adminBooking.lock_session.id) === id
  ) {
    delete session.adminBooking.lock_session;
    delete session.adminBooking.space_required;
  }

  return { removed: true };
}

function normalizeDatesPayload(datesPayload) {
  const source =
    datesPayload && typeof datesPayload === 'object' ? datesPayload : {};
  const normalized = {};
  for (const [ceDate, ceTime] of Object.entries(source)) {
    const key = toDateKey(ceDate);
    if (!key) continue;
    normalized[key] = ceTime;
  }
  return normalized;
}

async function setEventFreeze(pool, eventId, freeze, datesPayload) {
  const evId = Number(eventId);
  const freezeValue = Number(freeze);
  if (!Number.isFinite(evId) || evId <= 0) {
    const err = new Error('Invalid event');
    err.status = 400;
    throw err;
  }
  if (![1, 2].includes(freezeValue)) {
    const err = new Error('Invalid freeze value');
    err.status = 400;
    throw err;
  }

  const [eventRows] = await pool.query(
    'SELECT * FROM course_events WHERE id = ? LIMIT 1',
    [evId]
  );
  const eventData = eventRows?.[0];
  if (!eventData) {
    const err = new Error('Event not found');
    err.status = 404;
    throw err;
  }

  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates
     WHERE course_event_id = ?`,
    [evId]
  );
  // Prefer DB dates so freeze never depends on client-serialized Date keys
  // (e.g. "Tue Aug 11" from String(date).slice(0, 10)).
  const ceDatesFromDb = buildEventDatesMap(dateRows);
  const ceDates =
    Object.keys(ceDatesFromDb).length > 0
      ? ceDatesFromDb
      : normalizeDatesPayload(datesPayload);

  if (freezeValue === 1) {
    const [existing] = await pool.query(
      'SELECT COUNT(id) AS count_freeze FROM freeze WHERE course_event_id = ?',
      [evId]
    );
    if (Number(existing?.[0]?.count_freeze || 0) > 0) {
      return { frozen: true, message: 'Course event already frozen' };
    }

    await pool.query(
      `INSERT INTO freeze
        (parent, course_event_id, bookings_done, vehicle_type_manual,
         vehicle_type_automatic, booking_limit, manual_lock_done, automatic_lock_done)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventData.parent,
        evId,
        eventData.bookings_done,
        eventData.vehicle_type_manual,
        eventData.vehicle_type_automatic,
        eventData.booking_limit,
        eventData.manual_lock_done,
        eventData.automatic_lock_done,
      ]
    );

    const totalBookingDone =
      Number(eventData.vehicle_type_manual || 0) +
      Number(eventData.vehicle_type_automatic || 0);
    await pool.query('UPDATE course_events SET bookings_done = ? WHERE id = ?', [
      totalBookingDone,
      evId,
    ]);

    for (const [ceDate, ceTime] of Object.entries(ceDates)) {
      const times = String(ceTime || '').split(' - ');
      const eventDate = trim(ceDate) === 'TBC' ? TBC_DATE : toDateKey(ceDate);
      await pool.query(
        `UPDATE course_event_dates
         SET freeze = 1
         WHERE course_event_id = ? AND event_date = ?
           AND event_start_time = ? AND event_end_time = ?`,
        [evId, eventDate, trim(times[0]), trim(times[1])]
      );
    }

    return { frozen: true, message: 'Course event Freezed successfully' };
  }

  const [freezeRows] = await pool.query(
    'SELECT * FROM freeze WHERE course_event_id = ? LIMIT 1',
    [evId]
  );
  const freezeData = freezeRows?.[0];
  if (!freezeData) {
    return { frozen: false, message: 'Course event already active' };
  }

  await pool.query(
    `UPDATE course_events
     SET automatic_lock_done = ?, manual_lock_done = ?,
         vehicle_type_automatic = ?, vehicle_type_manual = ?,
         bookings_done = ?
     WHERE id = ?`,
    [
      freezeData.automatic_lock_done,
      freezeData.manual_lock_done,
      freezeData.vehicle_type_automatic,
      freezeData.vehicle_type_manual,
      freezeData.bookings_done,
      evId,
    ]
  );

  await pool.query('DELETE FROM freeze WHERE course_event_id = ? AND id = ?', [
    evId,
    freezeData.id,
  ]);

  for (const [ceDate, ceTime] of Object.entries(ceDates)) {
    const times = String(ceTime || '').split(' - ');
    const eventDate = trim(ceDate) === 'TBC' ? TBC_DATE : toDateKey(ceDate);
    await pool.query(
      `UPDATE course_event_dates
       SET freeze = 2
       WHERE course_event_id = ? AND event_date = ?
         AND event_start_time = ? AND event_end_time = ?`,
      [evId, eventDate, trim(times[0]), trim(times[1])]
    );
  }

  return { frozen: false, message: 'Course event Unfreezed successfully' };
}

module.exports = {
  getEventBookingPage,
  lockEventSeats,
  removeProcessLock,
  setEventFreeze,
  isEventFrozen,
};
