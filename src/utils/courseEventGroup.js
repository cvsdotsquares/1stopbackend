/**
 * Multi-day course events share a cohort via course_events.parent.
 *
 * Data conventions:
 * - event_type = 'single' — standalone; locks/bookings_done apply to this row only
 * - event_type = 'multi' — shared pool; all siblings share the same parent column value
 *   (legacy PHP: UPDATE … WHERE parent = (SELECT parent FROM course_events WHERE id = ?))
 * - parent: single → parent = event id or 0; multi → parent = first event id in the group
 */

const EVENT_TYPE_MULTI = 'multi';
const EVENT_TYPE_SINGLE = 'single';

const VALID_DATE_FILTER = `
  ced.event_date > '1900-01-01'
  AND ced.event_date NOT IN ('1111-11-11', '0000-00-00')
`;

const GROUP_MATCH_SQL = '(id = ?)';
const GROUP_MATCH_CE_SQL = '(ce.id = ? OR ce.parent = ?)';
const COHORT_BY_PARENT_SQL = 'parent = ?';
const MULTI_GROUP_MATCH_SQL = `event_type = '${EVENT_TYPE_MULTI}' AND ${GROUP_MATCH_SQL}`;
const MULTI_GROUP_MATCH_CE_SQL = `ce.event_type = '${EVENT_TYPE_MULTI}' AND ${GROUP_MATCH_CE_SQL}`;

function normalizeEventType(eventType) {
  return String(eventType || '').trim().toLowerCase();
}

function isMultiEventType(eventType) {
  return normalizeEventType(eventType) === EVENT_TYPE_MULTI;
}

function isSingleEventType(eventType) {
  const t = normalizeEventType(eventType);
  return t === EVENT_TYPE_SINGLE || t === '';
}

/** True when parent column marks a single-day event (not a child of another day). */
function isSelfParentedEvent(id, parent) {
  return parent === 0 || parent === id;
}

/** SQL expression for cohort root id on multi-day rows (alias `ce`). */
const ROOT_ID_SQL = `CASE WHEN COALESCE(ce.parent, 0) = 0 OR ce.parent = ce.id THEN ce.id ELSE ce.parent END`;

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} courseEventId
 * @returns {Promise<{ id: number, parent: number }|null>}
 */
async function getEventParentRow(db, courseEventId) {
  const [rows] = await db.query(
    'SELECT id, parent, event_type FROM course_events WHERE id = ? LIMIT 1',
    [courseEventId]
  );
  if (!rows.length) return null;
  return {
    id: Number(rows[0].id),
    parent: Number(rows[0].parent) || 0,
    event_type: rows[0].event_type,
  };
}

/**
 * Resolve cohort root id in memory (no DB).
 * @param {number} eventId
 * @param {number} parent
 * @param {string} [eventType]
 * @returns {number}
 */
function resolveGroupRootId(eventId, parent, eventType = '') {
  const id = Number(eventId);
  if (!isMultiEventType(eventType)) return id;
  const pid = Number(parent) || 0;
  if (isSelfParentedEvent(id, pid)) return id;
  return pid;
}

/**
 * Batch-load cohort data for course-availability (avoids N+1 queries per event row).
 * @param {import('mysql2/promise').Pool} db
 * @param {Array<{ eventId: number, parent: number, eventType?: string }>} entries
 * @param {number|null} locationId
 */
async function loadAvailabilityCohortCache(db, entries, locationId = null) {
  const rootByEventId = new Map();
  const isMultiByEventId = new Map();

  for (const { eventId, parent, eventType } of entries) {
    const id = Number(eventId);
    const multi = isMultiEventType(eventType);
    isMultiByEventId.set(id, multi);
    rootByEventId.set(id, resolveGroupRootId(id, parent, eventType));
  }

  const uniqueRoots = [
    ...new Set(
      [...rootByEventId.entries()]
        .filter(([eventId]) => isMultiByEventId.get(eventId))
        .map(([, rootId]) => rootId)
    ),
  ];

  if (!uniqueRoots.length) {
    return {
      rootByEventId,
      getRootId: (eventId) => rootByEventId.get(Number(eventId)),
      isLinked: () => false,
      isFirstDayPassed: () => false,
      getAvailability: () => null,
      getNearestPricing: () => null,
      getGroupFirstDate: () => null,
    };
  }

  const rootPlaceholders = uniqueRoots.map(() => '?').join(',');
  const inParams = [...uniqueRoots, ...uniqueRoots];

  const [cohortRows] = await db.query(
    `SELECT
       id,
       parent,
       location_id,
       booking_limit,
       bookings_done,
       COALESCE(current_locks, 0) AS current_locks,
       is_deposit,
       vehicle_type_manual,
       vehicle_type_automatic,
       vehicle_type_own,
       school_one_off_price,
       school_deposit_price,
       school_total_price,
       own_one_off_price,
       own_deposit_price,
       own_total_price
     FROM course_events
     WHERE event_type = ?
       AND (id IN (${rootPlaceholders}) OR parent IN (${rootPlaceholders}))`,
    [EVENT_TYPE_MULTI, ...inParams]
  );

  const membersByRoot = new Map();
  for (const row of cohortRows) {
    const rootId = resolveGroupRootId(row.id, row.parent, row.event_type);
    if (!membersByRoot.has(rootId)) membersByRoot.set(rootId, []);
    membersByRoot.get(rootId).push(row);
  }

  const availabilityByRoot = new Map();
  for (const [rootId, members] of membersByRoot) {
    let minAvailable = Infinity;
    let ref = members[0];
    for (const row of members) {
      const limit = Number(row.booking_limit) || 0;
      const done = Number(row.bookings_done) || 0;
      const locks = Number(row.current_locks) || 0;
      const available = limit - done - locks;
      if (available < minAvailable) {
        minAvailable = available;
        ref = row;
      }
    }
    availabilityByRoot.set(rootId, {
      booking_limit: Number(ref.booking_limit) || 0,
      bookings_done: Number(ref.bookings_done) || 0,
      current_locks: Number(ref.current_locks) || 0,
      availableSpaces: Math.max(0, minAvailable === Infinity ? 0 : minAvailable),
    });
  }

  const [dateRows] = await db.query(
    `SELECT
       ${ROOT_ID_SQL} AS root_id,
       ce.id AS event_id,
       ce.location_id,
       MIN(DATE(ced.event_date)) AS first_date,
       MIN(
         CASE
           WHEN DATE(ced.event_date) >= CURDATE() THEN DATE(ced.event_date)
         END
       ) AS nearest_upcoming
     FROM course_event_dates ced
     INNER JOIN course_events ce ON ce.id = ced.course_event_id
     WHERE ce.event_type = ?
       AND (ce.id IN (${rootPlaceholders}) OR ce.parent IN (${rootPlaceholders}))
       AND ${VALID_DATE_FILTER}
     GROUP BY root_id, ce.id, ce.location_id`,
    [EVENT_TYPE_MULTI, ...inParams]
  );

  const firstDateByRoot = new Map();
  const pricingCandidateByRoot = new Map();
  const locId = locationId != null ? Number(locationId) : null;

  for (const row of dateRows) {
    const rootId = Number(row.root_id);
    const firstDate = row.first_date
      ? (row.first_date instanceof Date
        ? row.first_date.toISOString().slice(0, 10)
        : String(row.first_date).slice(0, 10))
      : null;

    if (firstDate) {
      const prev = firstDateByRoot.get(rootId);
      if (!prev || firstDate < prev) firstDateByRoot.set(rootId, firstDate);
    }

    if (locId != null && Number(row.location_id) !== locId) continue;

    const nearest = row.nearest_upcoming
      ? (row.nearest_upcoming instanceof Date
        ? row.nearest_upcoming.toISOString().slice(0, 10)
        : String(row.nearest_upcoming).slice(0, 10))
      : firstDate;

    if (!nearest) continue;

    const eventId = Number(row.event_id);
    const prev = pricingCandidateByRoot.get(rootId);
    if (!prev || nearest < prev.nearest || (nearest === prev.nearest && eventId < prev.eventId)) {
      pricingCandidateByRoot.set(rootId, { eventId, nearest });
    }
  }

  const pricingByRoot = new Map();
  for (const [rootId, members] of membersByRoot) {
    const pick = pricingCandidateByRoot.get(rootId);
    if (pick) {
      const row = members.find((m) => Number(m.id) === pick.eventId);
      if (row) pricingByRoot.set(rootId, row);
      continue;
    }
    if (locId != null) {
      const atLoc = members.find((m) => Number(m.location_id) === locId);
      if (atLoc) pricingByRoot.set(rootId, atLoc);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const firstDayPassedByRoot = new Map();
  for (const [rootId, firstDate] of firstDateByRoot) {
    const members = membersByRoot.get(rootId) || [];
    if (members.length <= 1) {
      firstDayPassedByRoot.set(rootId, false);
      continue;
    }
    // Only multi-day packages hide siblings after day 1
    const first = new Date(`${firstDate}T00:00:00`);
    firstDayPassedByRoot.set(rootId, first < today);
  }

  return {
    rootByEventId,
    getRootId: (eventId) => rootByEventId.get(Number(eventId)),
    isLinked: (eventId) => {
      const id = Number(eventId);
      if (!isMultiByEventId.get(id)) return false;
      const rootId = rootByEventId.get(id);
      return (membersByRoot.get(rootId)?.length || 0) > 1;
    },
    isFirstDayPassed: (eventId) => {
      const id = Number(eventId);
      if (!isMultiByEventId.get(id)) return false;
      const rootId = rootByEventId.get(id);
      return firstDayPassedByRoot.get(rootId) === true;
    },
    getAvailability: (eventId) => {
      const id = Number(eventId);
      if (!isMultiByEventId.get(id)) return null;
      const rootId = rootByEventId.get(id);
      return availabilityByRoot.get(rootId) || null;
    },
    getNearestPricing: (eventId) => {
      const id = Number(eventId);
      if (!isMultiByEventId.get(id)) return null;
      const rootId = rootByEventId.get(id);
      return pricingByRoot.get(rootId) || null;
    },
    getGroupFirstDate: (eventId) => {
      const id = Number(eventId);
      if (!isMultiByEventId.get(id)) return null;
      const rootId = rootByEventId.get(id);
      return firstDateByRoot.get(rootId) || null;
    },
  };
}

/**
 * Cohort root event id (day-1 id for packages; own id for single-day).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} courseEventId
 * @returns {Promise<number|null>}
 */
async function getGroupRootId(db, courseEventId) {
  const row = await getEventParentRow(db, courseEventId);
  if (!row) return null;
  return resolveGroupRootId(row.id, row.parent, row.event_type);
}

/**
 * Parent column for multi-day child rows; null for single-day.
 */
async function getParentKey(db, courseEventId) {
  const row = await getEventParentRow(db, courseEventId);
  if (!row || !isMultiEventType(row.event_type)) return null;
  if (isSelfParentedEvent(row.id, row.parent)) return null;
  return row.parent;
}

/**
 * Shared parent key for a linked group (legacy booking.class.php addBookingsdone / lockBooking).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} courseEventId
 * @returns {Promise<number|null>}
 */
async function getLinkedParentKey(db, courseEventId) {
  const row = await getEventParentRow(db, courseEventId);
  if (!row || !isMultiEventType(row.event_type)) return null;
  const parentKey = Number(row.parent);
  return parentKey > 0 ? parentKey : null;
}

/**
 * Every course_event row in the shared pool (legacy: WHERE parent = parentKey).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} courseEventId
 * @returns {Promise<number[]>}
 */
async function getCohortMemberIds(db, courseEventId) {
  const row = await getEventParentRow(db, courseEventId);
  if (!row) return [Number(courseEventId)];
  if (!isMultiEventType(row.event_type)) {
    return [row.id];
  }

  const parentKey = await getLinkedParentKey(db, courseEventId);
  if (!parentKey) {
    return [row.id];
  }

  const [rows] = await db.query(
    `SELECT id FROM course_events WHERE ${COHORT_BY_PARENT_SQL} ORDER BY id ASC`,
    [parentKey]
  );
  if (!rows.length) return [row.id];
  return rows.map((r) => Number(r.id));
}

/**
 * Active cohort members only (for calendar / availability UI).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} courseEventId
 * @returns {Promise<number[]>}
 */
async function getSiblingEventIds(db, courseEventId) {
  const row = await getEventParentRow(db, courseEventId);
  if (!row) return [Number(courseEventId)];
  if (!isMultiEventType(row.event_type)) return [row.id];

  const parentKey = await getLinkedParentKey(db, courseEventId);
  if (!parentKey) return [row.id];

  const [rows] = await db.query(
    `SELECT id FROM course_events WHERE ${COHORT_BY_PARENT_SQL} AND (status = '1' OR status = 1) ORDER BY id ASC`,
    [parentKey]
  );
  if (!rows.length) return [row.id];
  return rows.map((r) => Number(r.id));
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} courseEventId
 * @returns {Promise<boolean>}
 */
async function isLinkedGroup(db, courseEventId) {
  const row = await getEventParentRow(db, courseEventId);
  if (!row || !isMultiEventType(row.event_type)) return false;
  const members = await getCohortMemberIds(db, courseEventId);
  return members.length > 1;
}

/**
 * Earliest calendar date across all siblings (day 1 of the package).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} groupRootId
 * @returns {Promise<string|null>} YYYY-MM-DD
 */
async function getGroupFirstEventDate(db, groupRootId) {
  const [rows] = await db.query(
    `SELECT MIN(DATE(ced.event_date)) AS first_date
     FROM course_event_dates ced
     INNER JOIN course_events ce ON ce.id = ced.course_event_id
     WHERE ${MULTI_GROUP_MATCH_CE_SQL}
       AND ce.status = '1'
       AND ${VALID_DATE_FILTER}`,
    [groupRootId, groupRootId]
  );
  const d = rows[0]?.first_date;
  if (!d) return null;
  if (d instanceof Date) {
    return d.toISOString().slice(0, 10);
  }
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * True when day 1 of a linked package has already passed (before today).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} courseEventId
 * @returns {Promise<boolean>}
 */
async function isGroupFirstDayPassed(db, courseEventId) {
  const row = await getEventParentRow(db, courseEventId);
  if (!row || !isMultiEventType(row.event_type)) return false;

  const siblings = await getSiblingEventIds(db, courseEventId);
  if (siblings.length <= 1) return false;

  const rootId = await getGroupRootId(db, courseEventId);
  if (!rootId) return false;

  const firstDate = await getGroupFirstEventDate(db, rootId);
  if (!firstDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const first = new Date(`${firstDate}T00:00:00`);
  return first < today;
}

/**
 * Sibling event id with the nearest upcoming date (ties: earliest id).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} courseEventId
 * @param {number|null} [locationId]
 * @returns {Promise<number|null>}
 */
async function getNearestDateSiblingEventId(db, courseEventId, locationId = null) {
  const siblings = await getSiblingEventIds(db, courseEventId);
  if (siblings.length <= 1) return Number(courseEventId);

  const rootId = await getGroupRootId(db, courseEventId);
  if (!rootId) return Number(courseEventId);

  const locationClause = locationId ? ' AND ce.location_id = ?' : '';
  const params = locationId ? [rootId, rootId, locationId] : [rootId, rootId];

  const [rows] = await db.query(
    `SELECT ce.id AS course_event_id, MIN(DATE(ced.event_date)) AS nearest_date
     FROM course_events ce
     INNER JOIN course_event_dates ced ON ced.course_event_id = ce.id
     WHERE ${MULTI_GROUP_MATCH_CE_SQL}
       AND ce.status = '1'
       AND DATE(ced.event_date) >= CURDATE()
       AND ${VALID_DATE_FILTER}
       ${locationClause}
     GROUP BY ce.id
     ORDER BY nearest_date ASC, ce.id ASC
     LIMIT 1`,
    params
  );

  if (rows.length) return Number(rows[0].course_event_id);

  const [fallback] = await db.query(
    `SELECT ce.id AS course_event_id, MIN(DATE(ced.event_date)) AS nearest_date
     FROM course_events ce
     INNER JOIN course_event_dates ced ON ced.course_event_id = ce.id
     WHERE ${MULTI_GROUP_MATCH_CE_SQL}
       AND ce.status = '1'
       AND ${VALID_DATE_FILTER}
       ${locationClause}
     GROUP BY ce.id
     ORDER BY nearest_date ASC, ce.id ASC
     LIMIT 1`,
    params
  );

  return fallback.length ? Number(fallback[0].course_event_id) : null;
}

/**
 * Min available spaces across siblings (shared cohort capacity).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} courseEventId
 * @returns {Promise<{ availableSpaces: number, booking_limit: number, bookings_done: number, current_locks: number }|null>}
 */
async function getGroupAvailability(db, courseEventId) {
  const cohortIds = await getCohortMemberIds(db, courseEventId);
  if (!cohortIds.length) return null;

  // Single-day (parent = event id): use only this event's counters
  if (cohortIds.length === 1) {
    const [rows] = await db.query(
      `SELECT booking_limit, bookings_done, COALESCE(current_locks, 0) AS current_locks
       FROM course_events WHERE id = ?`,
      [cohortIds[0]]
    );
    if (!rows.length) return null;
    const booking_limit = Number(rows[0].booking_limit) || 0;
    const bookings_done = Number(rows[0].bookings_done) || 0;
    const current_locks = Number(rows[0].current_locks) || 0;
    return {
      availableSpaces: Math.max(0, booking_limit - bookings_done - current_locks),
      booking_limit,
      bookings_done,
      current_locks,
    };
  }

  const placeholders = cohortIds.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT id, booking_limit, bookings_done, COALESCE(current_locks, 0) AS current_locks
     FROM course_events
     WHERE id IN (${placeholders})`,
    cohortIds
  );

  if (!rows.length) return null;

  let minAvailable = Infinity;
  let ref = rows[0];
  for (const row of rows) {
    const limit = Number(row.booking_limit) || 0;
    const done = Number(row.bookings_done) || 0;
    const locks = Number(row.current_locks) || 0;
    const available = limit - done - locks;
    if (available < minAvailable) {
      minAvailable = available;
      ref = row;
    }
  }

  const booking_limit = Number(ref.booking_limit) || 0;
  const bookings_done = Number(ref.bookings_done) || 0;
  const current_locks = Number(ref.current_locks) || 0;

  return {
    availableSpaces: Math.max(0, minAvailable === Infinity ? 0 : minAvailable),
    booking_limit,
    bookings_done,
    current_locks,
  };
}

/**
 * Row-lock all siblings in a linked group (call inside a transaction before reads/updates).
 * @param {import('mysql2/promise').PoolConnection} connection
 * @param {number} courseEventId
 */
async function lockSiblingEventsForUpdate(connection, courseEventId) {
  const cohortIds = await getCohortMemberIds(connection, courseEventId);
  if (!cohortIds.length) return;

  if (cohortIds.length === 1) {
    await connection.query(
      'SELECT id FROM course_events WHERE id = ? FOR UPDATE',
      [courseEventId]
    );
    return;
  }

  const placeholders = cohortIds.map(() => '?').join(',');
  await connection.query(
    `SELECT id FROM course_events WHERE id IN (${placeholders}) FOR UPDATE`,
    cohortIds
  );
}

/**
 * Apply lock / unlock / bookings_done delta to every sibling in the group.
 * @param {import('mysql2/promise').PoolConnection} connection
 * @param {number} courseEventId
 * @param {{ lockDelta?: number, bookingsDoneDelta?: number }} deltas
 */
async function applyGroupSpaceDelta(connection, courseEventId, { lockDelta = 0, bookingsDoneDelta = 0 }) {
  if (!lockDelta && !bookingsDoneDelta) return;

  const row = await getEventParentRow(connection, courseEventId);
  if (!row) return;

  const parentKey = await getLinkedParentKey(connection, courseEventId);
  const useParentGroup = Boolean(parentKey && isMultiEventType(row.event_type));

  const sets = [];
  const params = [];

  if (lockDelta) {
    sets.push('current_locks = GREATEST(0, current_locks + ?)');
    params.push(lockDelta);
  }
  if (bookingsDoneDelta) {
    sets.push('bookings_done = GREATEST(0, bookings_done + ?)');
    params.push(bookingsDoneDelta);
  }
  sets.push('modified = NOW()');

  let result;

  if (useParentGroup) {
    params.push(parentKey);
    [result] = await connection.query(
      `UPDATE course_events SET ${sets.join(', ')} WHERE ${COHORT_BY_PARENT_SQL}`,
      params
    );

    // Shared pool: after increment, normalize drift so every sibling matches MAX (legacy behaviour).
    // Do not run on decrement — cancellation/refund must only subtract, never bump a lagging sibling.
    if (bookingsDoneDelta > 0) {
      await connection.query(
        `UPDATE course_events ce
         INNER JOIN (
           SELECT MAX(bookings_done) AS mx FROM course_events WHERE parent = ?
         ) agg
         SET ce.bookings_done = agg.mx, ce.modified = NOW()
         WHERE ce.parent = ?`,
        [parentKey, parentKey]
      );
    }
  } else {
    params.push(Number(courseEventId));
    [result] = await connection.query(
      `UPDATE course_events SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
  }
}

/**
 * Pricing row for a course event (subset of course_events columns).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} db
 * @param {number} eventId
 */
async function getEventPricingRow(db, eventId) {
  const [rows] = await db.query(
    `SELECT
       id,
       is_deposit,
       vehicle_type_manual,
       vehicle_type_automatic,
       vehicle_type_own,
       school_one_off_price,
       school_deposit_price,
       school_total_price,
       own_one_off_price,
       own_deposit_price,
       own_total_price
     FROM course_events
     WHERE id = ?
     LIMIT 1`,
    [eventId]
  );
  return rows[0] || null;
}

module.exports = {
  EVENT_TYPE_MULTI,
  EVENT_TYPE_SINGLE,
  isMultiEventType,
  isSingleEventType,
  resolveGroupRootId,
  loadAvailabilityCohortCache,
  getGroupRootId,
  getParentKey,
  getLinkedParentKey,
  getCohortMemberIds,
  getLinkedCourseEventIds: getCohortMemberIds,
  getSiblingEventIds,
  isLinkedGroup,
  getGroupFirstEventDate,
  isGroupFirstDayPassed,
  getNearestDateSiblingEventId,
  getGroupAvailability,
  lockSiblingEventsForUpdate,
  applyGroupSpaceDelta,
  getEventPricingRow,
};
