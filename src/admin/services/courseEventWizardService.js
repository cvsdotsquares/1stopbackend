const {
  TBC_EVENT_DATE,
  normalizeSqlDateRaw,
} = require('./courseEventsService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function emptyLinkEntry() {
  return {
    course: '',
    vehicle_type_manual: 0,
    vehicle_type_automatic: 0,
    vehicle_type_own: 0,
    school_one_off_price: 0,
    school_deposit_price: 0,
    school_total_price: 0,
    own_one_off_price: 0,
    own_deposit_price: 0,
    own_total_price: 0,
  };
}

function emptyWizardState() {
  return {
    id: null,
    event_type: 'single',
    franchise_id: 0,
    location_id: '',
    booking_limit: '',
    eventsDates: {},
    multi: [emptyLinkEntry()],
    isBulkEdit: false,
    bulkEventIds: [],
    is_deposit: 0,
  };
}

function normalizeWizardState(raw) {
  const base = emptyWizardState();
  if (!raw || typeof raw !== 'object') return base;

  return {
    ...base,
    ...raw,
    event_type: raw.event_type === 'multi' ? 'multi' : 'single',
    id: raw.id ? Number(raw.id) : null,
    franchise_id: raw.franchise_id ?? 0,
    location_id: raw.location_id ?? '',
    booking_limit: raw.booking_limit ?? '',
    eventsDates:
      raw.eventsDates && typeof raw.eventsDates === 'object'
        ? raw.eventsDates
        : {},
    multi: Array.isArray(raw.multi) && raw.multi.length
      ? raw.multi.map((entry) => ({ ...emptyLinkEntry(), ...entry }))
      : [emptyLinkEntry()],
    isBulkEdit: Boolean(raw.isBulkEdit),
    bulkEventIds: Array.isArray(raw.bulkEventIds)
      ? raw.bulkEventIds.map(Number).filter((id) => id > 0)
      : [],
    is_deposit: Number(raw.is_deposit) > 0 ? 1 : 0,
  };
}

function getWizardState(session) {
  return normalizeWizardState(session?.courseEvent);
}

function setWizardState(session, state) {
  session.courseEvent = normalizeWizardState(state);
}

function clearWizardState(session) {
  delete session.courseEvent;
  delete session.eventIds;
}

function mergeWizardState(session, patch) {
  const current = getWizardState(session);
  const next = normalizeWizardState({ ...current, ...patch });
  setWizardState(session, next);
  return next;
}

function sortEventDateKeys(eventsDates) {
  const keys = Object.keys(eventsDates || {});
  return keys.sort((a, b) => {
    const aTbc = a === TBC_EVENT_DATE;
    const bTbc = b === TBC_EVENT_DATE;
    if (aTbc && !bTbc) return 1;
    if (!aTbc && bTbc) return -1;
    return a.localeCompare(b);
  });
}

function buildCalendarMonth(monthInput, yearInput) {
  const month = Math.min(12, Math.max(1, Number(monthInput) || new Date().getMonth() + 1));
  const year = Number(yearInput) || new Date().getFullYear();
  const lastDayNum = new Date(year, month, 0).getDate();
  const weeks = [];
  let currentWeek = [];

  const startPad =
    new Date(year, month - 1, 1).getDay() === 0
      ? 6
      : new Date(year, month - 1, 1).getDay() - 1;
  for (let i = 0; i < startPad; i += 1) {
    currentWeek.push(null);
  }

  for (let dayNum = 1; dayNum <= lastDayNum; dayNum += 1) {
    const day = new Date(year, month - 1, dayNum);
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    currentWeek.push({
      iso,
      day: dayNum,
      label: day.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      isWeekend: day.getDay() === 0 || day.getDay() === 6,
    });
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length) {
    while (currentWeek.length < 7) currentWeek.push(null);
    weeks.push(currentWeek);
  }

  const prev = new Date(year, month - 2, 1);
  const next = new Date(year, month, 1);

  return {
    month,
    year,
    weeks,
    prevMonth: prev.getMonth() + 1,
    prevYear: prev.getFullYear(),
    nextMonth: next.getMonth() + 1,
    nextYear: next.getFullYear(),
    monthLabel: new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
      month: 'long',
    }),
  };
}

async function getWizardFormOptions(pool, { includeLocationId } = {}) {
  const [courseRows] = await pool.query(
    `SELECT id, course_name, default_booking_limit, default_manual_vehicle,
            default_automatic_vehicle, default_start_time, default_end_time,
            deposit_days, cancel_days
     FROM courses
     WHERE isDeleted = '0' AND status IN ('1', '2')
     ORDER BY course_name ASC`
  );

  const includeId = Number(includeLocationId);
  const locationParams = [];
  let locationWhere =
    "status = '1' AND COALESCE(show_as_location_for_courses, 1) = 1";
  if (Number.isFinite(includeId) && includeId > 0) {
    locationWhere =
      "status = '1' AND (COALESCE(show_as_location_for_courses, 1) = 1 OR id = ?)";
    locationParams.push(includeId);
  }

  const [locationRows] = await pool.query(
    `SELECT id, location_name
     FROM locations
     WHERE ${locationWhere}
     ORDER BY location_name ASC`,
    locationParams
  );

  const [franchiseRows] = await pool.query(
    `SELECT id, franchise_name, prim_franch
     FROM franchise
     WHERE isDeleted = '0' AND status = '1'
     ORDER BY franchise_name ASC`
  );

  const primaryFranchise =
    (franchiseRows || []).find((row) => String(row.prim_franch) === '1') ||
    franchiseRows?.[0] ||
    null;

  return {
    courses: (courseRows || []).map((row) => ({
      value: String(row.id),
      label: row.course_name,
      default_booking_limit: row.default_booking_limit,
      default_manual_vehicle: row.default_manual_vehicle,
      default_automatic_vehicle: row.default_automatic_vehicle,
      default_start_time: row.default_start_time || '',
      default_end_time: row.default_end_time || '',
      cancel_days: Number(row.cancel_days ?? row.deposit_days ?? 7) || 7,
      deposit_days: Number(row.deposit_days ?? row.cancel_days ?? 7) || 7,
    })),
    locations: (locationRows || []).map((row) => ({
      value: String(row.id),
      label: row.location_name,
    })),
    franchises: (franchiseRows || []).map((row) => ({
      value: String(row.id),
      label: row.franchise_name,
      is_primary: String(row.prim_franch) === '1',
    })),
    primaryFranchiseId: primaryFranchise ? String(primaryFranchise.id) : '',
  };
}

async function buildEventWizardState(pool, eventId) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const [[event]] = await pool.query(
    'SELECT * FROM course_events WHERE id = ? LIMIT 1',
    [id]
  );
  if (!event) return null;

  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates
     WHERE course_event_id = ?
     ORDER BY event_date ASC`,
    [id]
  );

  const eventsDates = {};
  for (const row of dateRows || []) {
    const key = normalizeSqlDateRaw(row.event_date);
    eventsDates[key] = {
      s: row.event_start_time || '',
      e: row.event_end_time || '',
    };
  }

  return normalizeWizardState({
    id: event.id,
    event_type: event.event_type || 'single',
    location_id: event.location_id,
    franchise_id: event.franchise_id,
    booking_limit: event.booking_limit,
    eventsDates,
    multi: [
      {
        course: event.course_id,
        vehicle_type_manual: event.vehicle_type_manual || 0,
        vehicle_type_automatic: event.vehicle_type_automatic || 0,
        vehicle_type_own: event.vehicle_type_own || 0,
        school_one_off_price: event.school_one_off_price || 0,
        school_deposit_price: event.school_deposit_price || 0,
        school_total_price: event.school_total_price || 0,
        own_one_off_price: event.own_one_off_price || 0,
        own_deposit_price: event.own_deposit_price || 0,
        own_total_price: event.own_total_price || 0,
      },
    ],
    isBulkEdit: false,
    bulkEventIds: [],
    is_deposit: Number(event.is_deposit) > 0 ? 1 : 0,
  });
}

async function getBulkEditDates(pool, eventIds) {
  if (!eventIds.length) return [];

  const [rows] = await pool.query(
    `SELECT course_event_dates.id AS main_id,
            course_event_dates.course_event_id AS eid,
            course_event_dates.event_date,
            course_event_dates.event_start_time,
            course_event_dates.event_end_time,
            course_events.event_type
     FROM course_event_dates
     JOIN course_events ON course_events.id = course_event_dates.course_event_id
     WHERE course_event_dates.course_event_id IN (?)
     ORDER BY FIELD(course_event_dates.event_date, '0000-00-00') ASC,
              course_event_dates.event_date ASC`,
    [eventIds]
  );

  return (rows || []).map((row) => ({
    main_id: row.main_id,
    eid: row.eid,
    event_date: row.event_date,
    event_start_time: row.event_start_time || '',
    event_end_time: row.event_end_time || '',
    event_type: row.event_type,
    is_tbc: row.event_date === TBC_EVENT_DATE,
  }));
}

async function prepareEditWizard(session, pool, eventId) {
  const state = await buildEventWizardState(pool, eventId);
  if (!state) {
    const err = new Error('Event not found to edit');
    err.status = 404;
    throw err;
  }
  setWizardState(session, state);
  return state;
}

async function prepareBulkEditWizard(session, pool, { primaryEventId, eventIds }) {
  const ids = [...new Set(eventIds.map(Number).filter((id) => id > 0))];
  if (!ids.length) {
    const err = new Error('No events selected for bulk edit');
    err.status = 400;
    throw err;
  }

  const primaryId = Number(primaryEventId) || ids[0];
  const state = await buildEventWizardState(pool, primaryId);
  if (!state) {
    const err = new Error('Event not found to edit');
    err.status = 404;
    throw err;
  }

  state.isBulkEdit = true;
  state.bulkEventIds = ids;
  state.id = null;
  setWizardState(session, state);
  session.eventIds = ids;

  const bulkDates = await getBulkEditDates(pool, ids);
  return { state, bulkDates };
}

async function isEventFrozen(pool, eventId) {
  const [rows] = await pool.query(
    'SELECT id FROM freeze WHERE course_event_id = ? LIMIT 1',
    [eventId]
  );
  return (rows || []).length > 0;
}

async function applyFrozenState(pool, eventId, eventsDates, freezeAllDates) {
  if (!freezeAllDates) return;

  const [[event]] = await pool.query(
    'SELECT * FROM course_events WHERE id = ? LIMIT 1',
    [eventId]
  );
  if (!event) return;

  const [existing] = await pool.query(
    'SELECT id FROM freeze WHERE course_event_id = ? LIMIT 1',
    [eventId]
  );
  if ((existing || []).length) return;

  await pool.query(
    `INSERT INTO freeze
      (parent, course_event_id, bookings_done, vehicle_type_manual,
       vehicle_type_automatic, booking_limit, manual_lock_done, automatic_lock_done)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.parent,
      eventId,
      event.bookings_done,
      event.vehicle_type_manual,
      event.vehicle_type_automatic,
      event.booking_limit,
      event.manual_lock_done,
      event.automatic_lock_done,
    ]
  );

  const totalBookings =
    Number(event.vehicle_type_manual || 0) +
    Number(event.vehicle_type_automatic || 0);
  await pool.query('UPDATE course_events SET bookings_done = ? WHERE id = ?', [
    totalBookings,
    eventId,
  ]);

  for (const [dateKey, times] of Object.entries(eventsDates || {})) {
    await pool.query(
      `UPDATE course_event_dates
       SET freeze = 1
       WHERE course_event_id = ? AND event_date = ?
         AND event_start_time = ? AND event_end_time = ?`,
      [eventId, dateKey, times.s || '', times.e || '']
    );
  }
}

async function assertLocationAllowedForCourses(
  pool,
  locationId,
  { allowLocationIds = [] } = {}
) {
  const id = Number(locationId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('Required fields marked with * can not be left blank');
    err.status = 400;
    throw err;
  }

  const allowedExisting = (allowLocationIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (allowedExisting.includes(id)) {
    return;
  }

  const [rows] = await pool.query(
    `SELECT id FROM locations
     WHERE id = ?
       AND status = '1'
       AND COALESCE(show_as_location_for_courses, 1) = 1
     LIMIT 1`,
    [id]
  );
  if (!rows?.length) {
    const err = new Error(
      'Selected location is not available for courses'
    );
    err.status = 400;
    throw err;
  }
}

function validateWizardForSave(state, payload) {
  if (!state.eventsDates || !Object.keys(state.eventsDates).length) {
    const err = new Error('Please first fill out date(s) of course');
    err.status = 400;
    throw err;
  }
  if (!trim(state.event_type)) {
    const err = new Error('Please first fill out Course type and date(s) of course');
    err.status = 400;
    throw err;
  }
  if (!trim(payload.location_id) || !trim(payload.booking_limit)) {
    const err = new Error('Required fields marked with * can not be left blank');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(payload.multi) || !payload.multi.length) {
    const err = new Error('Course details are required');
    err.status = 400;
    throw err;
  }
  for (const link of payload.multi) {
    if (!trim(link.course)) {
      const err = new Error('Course is required');
      err.status = 400;
      throw err;
    }
  }
}

async function assertBookingLimit(pool, eventId, bookingLimit) {
  const [[event]] = await pool.query(
    'SELECT booking_limit, bookings_done, current_locks FROM course_events WHERE id = ? LIMIT 1',
    [eventId]
  );
  if (!event) return;
  const minRequired =
    Number(event.current_locks || 0) + Number(event.bookings_done || 0);
  if (Number(bookingLimit) < minRequired) {
    const err = new Error('Booking Limit can not be less then current bookings');
    err.status = 400;
    throw err;
  }
}

async function insertEventDates(pool, eventId, eventsDates) {
  for (const dateKey of sortEventDateKeys(eventsDates)) {
    const times = eventsDates[dateKey];
    await pool.query(
      `INSERT INTO course_event_dates
        (course_event_id, event_date, event_start_time, event_end_time)
       VALUES (?, ?, ?, ?)`,
      [eventId, dateKey, times.s || '', times.e || '']
    );
  }
}

async function saveBulkEditWizard(pool, session, payload, { previousLocationId } = {}) {
  const state = getWizardState(session);
  const eventIds = state.bulkEventIds?.length
    ? state.bulkEventIds
    : session.eventIds || [];
  if (!eventIds.length) {
    const err = new Error('No events selected for bulk edit');
    err.status = 400;
    throw err;
  }

  validateWizardForSave(state, payload);
  await assertLocationAllowedForCourses(pool, payload.location_id, {
    allowLocationIds: [previousLocationId],
  });
  const link = payload.multi[0];
  const freezeAllDates = Boolean(payload.frozenAllDates);
  const isDeposit = payload.is_deposit ? 1 : 0;
  const bulkDates = Array.isArray(payload.bulkDates) ? payload.bulkDates : [];
  const updatedEvents = new Set();

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const row of bulkDates) {
      const eventId = Number(row.eid);
      const dateRowId = Number(row.main_id);
      const dateKey = row.event_date;
      if (!eventId || !dateRowId) continue;

      if (!updatedEvents.has(eventId)) {
        await assertBookingLimit(connection, eventId, payload.booking_limit);
        await connection.query(
          `UPDATE course_events SET
            event_type = ?,
            course_id = ?,
            location_id = ?,
            franchise_id = ?,
            booking_limit = ?,
            vehicle_type_manual = ?,
            vehicle_type_automatic = ?,
            vehicle_type_own = ?,
            school_one_off_price = ?,
            school_deposit_price = ?,
            school_total_price = ?,
            own_one_off_price = ?,
            own_deposit_price = ?,
            own_total_price = ?,
            modified = ?,
            is_deposit = ?
           WHERE id = ?`,
          [
            state.event_type,
            link.course,
            payload.location_id,
            payload.franchise_id || 0,
            payload.booking_limit,
            link.vehicle_type_manual || 0,
            link.vehicle_type_automatic || 0,
            link.vehicle_type_own || 0,
            link.school_one_off_price || 0,
            link.school_deposit_price || 0,
            link.school_total_price || 0,
            link.own_one_off_price || 0,
            link.own_deposit_price || 0,
            link.own_total_price || 0,
            formatTimestamp(),
            isDeposit,
            eventId,
          ]
        );
        updatedEvents.add(eventId);
      }

      if (dateKey !== TBC_EVENT_DATE) {
        await connection.query(
          `UPDATE course_event_dates
           SET event_start_time = ?, event_end_time = ?
           WHERE id = ?`,
          [row.s || '', row.e || '', dateRowId]
        );
      }

      if (freezeAllDates) {
        await applyFrozenState(
          connection,
          eventId,
          { [dateKey]: { s: row.s, e: row.e } },
          true
        );
      }
    }

    await connection.commit();
    clearWizardState(session);
    return { message: 'Course event saved successfully' };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function saveWizard(pool, session, payload) {
  const current = getWizardState(session);
  const previousLocationId = current.location_id;
  mergeWizardState(session, {
    location_id: payload.location_id ?? current.location_id,
    franchise_id: payload.franchise_id ?? current.franchise_id,
    booking_limit: payload.booking_limit ?? current.booking_limit,
    eventsDates: payload.eventsDates ?? current.eventsDates,
    multi: payload.multi ?? current.multi,
  });
  const state = getWizardState(session);
  if (state.isBulkEdit) {
    return saveBulkEditWizard(pool, session, payload, { previousLocationId });
  }

  validateWizardForSave(state, payload);
  await assertLocationAllowedForCourses(pool, payload.location_id, {
    allowLocationIds: [previousLocationId],
  });

  const eventsDates = state.eventsDates;
  const freezeAllDates = Boolean(payload.frozenAllDates);
  const isDeposit = payload.is_deposit ? 1 : 0;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    let parentId = 0;
    let inserted = 0;
    // ENUM('0','1'): numeric 1 means index 1 → '0'; use string '1' for active.
    const activeStatus = '1';

    for (const link of payload.multi) {
      if (state.event_type === 'multi') {
        let lastId = state.id;

        if (state.id) {
          await assertBookingLimit(connection, state.id, payload.booking_limit);
          await connection.query(
            'DELETE FROM course_event_dates WHERE course_event_id = ?',
            [state.id]
          );
          await connection.query(
            `UPDATE course_events SET
              event_type = ?, course_id = ?, location_id = ?, franchise_id = ?,
              booking_limit = ?, vehicle_type_manual = ?, vehicle_type_automatic = ?,
              vehicle_type_own = ?, school_one_off_price = ?, school_deposit_price = ?,
              school_total_price = ?, own_one_off_price = ?, own_deposit_price = ?,
              own_total_price = ?, modified = ?, is_deposit = ?
             WHERE id = ?`,
            [
              state.event_type,
              link.course,
              payload.location_id,
              payload.franchise_id || 0,
              payload.booking_limit,
              link.vehicle_type_manual || 0,
              link.vehicle_type_automatic || 0,
              link.vehicle_type_own || 0,
              link.school_one_off_price || 0,
              link.school_deposit_price || 0,
              link.school_total_price || 0,
              link.own_one_off_price || 0,
              link.own_deposit_price || 0,
              link.own_total_price || 0,
              formatTimestamp(),
              isDeposit,
              state.id,
            ]
          );
          inserted = 1;
          lastId = state.id;
        } else {
          const [result] = await connection.query(
            `INSERT INTO course_events
              (event_type, course_id, location_id, franchise_id, booking_limit,
               vehicle_type_manual, vehicle_type_automatic, vehicle_type_own,
               school_one_off_price, school_deposit_price, school_total_price,
               own_one_off_price, own_deposit_price, own_total_price,
               parent, status, created, is_deposit)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              state.event_type,
              link.course,
              payload.location_id,
              payload.franchise_id || 0,
              payload.booking_limit,
              link.vehicle_type_manual || 0,
              link.vehicle_type_automatic || 0,
              link.vehicle_type_own || 0,
              link.school_one_off_price || 0,
              link.school_deposit_price || 0,
              link.school_total_price || 0,
              link.own_one_off_price || 0,
              link.own_deposit_price || 0,
              link.own_total_price || 0,
              parentId,
              activeStatus,
              formatTimestamp(),
              isDeposit,
            ]
          );
          lastId = result.insertId;
          inserted = 1;
          if (!parentId) parentId = lastId;
        }

        await insertEventDates(connection, lastId, eventsDates);
        if (freezeAllDates) {
          await applyFrozenState(connection, lastId, eventsDates, true);
        }
      } else if (state.event_type === 'single') {
        for (const dateKey of sortEventDateKeys(eventsDates)) {
          const times = eventsDates[dateKey];

          if (state.id) {
            await assertBookingLimit(
              connection,
              state.id,
              payload.booking_limit
            );
            await connection.query(
              'DELETE FROM course_event_dates WHERE course_event_id = ?',
              [state.id]
            );
            await connection.query(
              `UPDATE course_events SET
                event_type = ?, course_id = ?, location_id = ?, franchise_id = ?,
                booking_limit = ?, vehicle_type_manual = ?, vehicle_type_automatic = ?,
                vehicle_type_own = ?, school_one_off_price = ?, school_deposit_price = ?,
                school_total_price = ?, own_one_off_price = ?, own_deposit_price = ?,
                own_total_price = ?, modified = ?, is_deposit = ?
               WHERE id = ?`,
              [
                state.event_type,
                link.course,
                payload.location_id,
                payload.franchise_id || 0,
                payload.booking_limit,
                link.vehicle_type_manual || 0,
                link.vehicle_type_automatic || 0,
                link.vehicle_type_own || 0,
                link.school_one_off_price || 0,
                link.school_deposit_price || 0,
                link.school_total_price || 0,
                link.own_one_off_price || 0,
                link.own_deposit_price || 0,
                link.own_total_price || 0,
                formatTimestamp(),
                isDeposit,
                state.id,
              ]
            );
            await connection.query(
              `INSERT INTO course_event_dates
                (course_event_id, event_date, event_start_time, event_end_time)
               VALUES (?, ?, ?, ?)`,
              [state.id, dateKey, times.s || '', times.e || '']
            );
            if (freezeAllDates) {
              await applyFrozenState(
                connection,
                state.id,
                { [dateKey]: times },
                true
              );
            }
            inserted = 1;
            break;
          }

          const [result] = await connection.query(
            `INSERT INTO course_events
              (event_type, course_id, location_id, franchise_id, booking_limit,
               vehicle_type_manual, vehicle_type_automatic, vehicle_type_own,
               school_one_off_price, school_deposit_price, school_total_price,
               own_one_off_price, own_deposit_price, own_total_price,
               parent, status, created, is_deposit)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              state.event_type,
              link.course,
              payload.location_id,
              payload.franchise_id || 0,
              payload.booking_limit,
              link.vehicle_type_manual || 0,
              link.vehicle_type_automatic || 0,
              link.vehicle_type_own || 0,
              link.school_one_off_price || 0,
              link.school_deposit_price || 0,
              link.school_total_price || 0,
              link.own_one_off_price || 0,
              link.own_deposit_price || 0,
              link.own_total_price || 0,
              parentId,
              activeStatus,
              formatTimestamp(),
              isDeposit,
            ]
          );
          const newId = result.insertId;
          parentId = newId;
          await connection.query(
            'UPDATE course_events SET parent = ? WHERE id = ?',
            [newId, newId]
          );
          await connection.query(
            `INSERT INTO course_event_dates
              (course_event_id, event_date, event_start_time, event_end_time)
             VALUES (?, ?, ?, ?)`,
            [newId, dateKey, times.s || '', times.e || '']
          );
          if (freezeAllDates) {
            await applyFrozenState(
              connection,
              newId,
              { [dateKey]: times },
              true
            );
          }
          inserted = 1;
        }
        break;
      }
    }

    if (!state.id && state.event_type === 'multi' && parentId) {
      await connection.query(
        'UPDATE course_events SET parent = ? WHERE id = ?',
        [parentId, parentId]
      );
    }

    if (!inserted) {
      const err = new Error('Error in saving course event');
      err.status = 400;
      throw err;
    }

    await connection.commit();
    clearWizardState(session);
    return { message: 'Course event saved successfully' };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  TBC_EVENT_DATE,
  emptyWizardState,
  getWizardState,
  setWizardState,
  clearWizardState,
  mergeWizardState,
  sortEventDateKeys,
  buildCalendarMonth,
  getWizardFormOptions,
  buildEventWizardState,
  getBulkEditDates,
  prepareEditWizard,
  prepareBulkEditWizard,
  isEventFrozen,
  saveWizard,
};
