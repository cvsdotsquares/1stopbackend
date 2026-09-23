/**
 * F-020 — In-progress bookings list.
 * Replaces legacy `current_booking_details.php` (direct DB query, no PHP HTTP calls).
 */
const {
  LOCK_EXPIRE_TIME_MINUTES,
  STRIPE_PAYMENT_LINK_LOCKED_BY,
} = require('../constants');
const { removeExpirelocks } = require('./bookingService');
const { getExpireMinutes } = require('./bookingStripeLinkService');

const GUEST_LOCK_EXPIRE_MINUTES = 10;
const PENDING_STRIPE_PAYMENT_TYPE = 'STRIPE_LINK';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatEventDateLabel(evDate) {
  if (!evDate || evDate === '0000-00-00') return 'TBC';
  if (evDate instanceof Date && !Number.isNaN(evDate.getTime())) {
    return `${pad2(evDate.getUTCDate())}-${pad2(evDate.getUTCMonth() + 1)}-${evDate.getUTCFullYear()}`;
  }
  const raw = String(evDate).trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const d = new Date(`${iso[1]}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return `${pad2(d.getUTCDate())}-${pad2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
    }
  }
  return raw || 'TBC';
}

function lockExpiryMinutes(lockedBy, userId) {
  const uid = Number(userId);
  const isGuest =
    (!Number.isFinite(uid) || uid === 0) && String(lockedBy || '') === 'online';
  if (String(lockedBy || '').trim() === STRIPE_PAYMENT_LINK_LOCKED_BY) {
    return getExpireMinutes();
  }
  if (isGuest) return GUEST_LOCK_EXPIRE_MINUTES;
  return LOCK_EXPIRE_TIME_MINUTES;
}

function mysqlDateToUnix(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Math.floor(value.getTime() / 1000);
  }
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
}

function parseStripeLinkExpiresUnix(responseRaw, lockCreatedUnix = 0) {
  if (!responseRaw) return 0;
  try {
    const parsed =
      typeof responseRaw === 'string' ? JSON.parse(responseRaw) : responseRaw;
    const quotedMinutes = Number(parsed?.expire_minutes);
    const minutes =
      Number.isFinite(quotedMinutes) && quotedMinutes > 0
        ? quotedMinutes
        : getExpireMinutes();

    if (parsed?.expires_at) {
      const ms = Date.parse(parsed.expires_at);
      if (Number.isFinite(ms)) {
        let unix = Math.floor(ms / 1000);
        if (lockCreatedUnix > 0) {
          const cap = lockCreatedUnix + minutes * 60 + 30;
          if (unix > cap) {
            unix = lockCreatedUnix + minutes * 60;
          }
        }
        return unix;
      }
    }
  } catch {
    return 0;
  }
  return 0;
}

async function loadStripeExpiryByLockId(pool, lockCreatedById) {
  const ids = [...lockCreatedById.keys()];
  const map = new Map();
  if (!ids.length) return map;

  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT b.lockid AS lock_id, bp.response
     FROM bookings b
     INNER JOIN booking_payments bp
       ON bp.booking_id = b.id
      AND bp.payment_type = ?
      AND bp.isDelete = 0
     WHERE b.lockid IN (${placeholders})
       AND b.status = 0`,
    [PENDING_STRIPE_PAYMENT_TYPE, ...ids]
  );

  for (const row of rows || []) {
    const lockId = Number(row.lock_id);
    const expiresUnix = parseStripeLinkExpiresUnix(
      row.response,
      lockCreatedById.get(lockId) || 0
    );
    if (!lockId || !expiresUnix) continue;
    const existing = map.get(lockId) || 0;
    if (!existing || expiresUnix > existing) {
      map.set(lockId, expiresUnix);
    }
  }
  return map;
}

/**
 * `course_events.current_locks` is duplicated across cohort siblings; locks live in
 * `lock_bookings`. Clear stale counts when no active lock row exists for the cohort.
 */
async function reconcileOrphanedCurrentLocks(pool) {
  await pool.query(
    `UPDATE course_events ce
     SET ce.current_locks = 0
     WHERE ce.current_locks > 0
       AND ce.parent > 0
       AND NOT EXISTS (
         SELECT 1 FROM lock_bookings lb
         WHERE lb.delete_process = 0 AND lb.parent = ce.parent
       )`
  );

  await pool.query(
    `UPDATE course_events ce
     SET ce.current_locks = 0
     WHERE ce.current_locks > 0
       AND (ce.parent IS NULL OR ce.parent = 0)
       AND NOT EXISTS (
         SELECT 1 FROM lock_bookings lb
         WHERE lb.delete_process = 0 AND lb.event_id = ce.id
       )`
  );
}

async function getInProgressBookings(pool, session) {
  await removeExpirelocks(pool, session);

  const stripeMinutes = getExpireMinutes();
  const adminMinutes = LOCK_EXPIRE_TIME_MINUTES;
  const guestMinutes = GUEST_LOCK_EXPIRE_MINUTES;

  const [rows] = await pool.query(
    `SELECT
      lb.id AS lock_id,
      ce.id AS course_event_id,
      lb.created AS booking_date,
      c.course_name AS booking_course,
      l.location_name AS booking_location,
      (SELECT ced.event_date FROM course_event_dates ced WHERE ced.course_event_id = ce.id LIMIT 1) AS evDate,
      (SELECT ced.event_start_time FROM course_event_dates ced WHERE ced.course_event_id = ce.id LIMIT 1) AS evStart,
      (SELECT ced.event_end_time FROM course_event_dates ced WHERE ced.course_event_id = ce.id LIMIT 1) AS evEnd,
      lb.locked_by,
      lb.user_id,
      lb.space_required,
      lb.ip_address,
      lb.payment_page_stauts AS paymentStatus,
      (
        UNIX_TIMESTAMP(lb.created) + (
          CASE
            WHEN lb.locked_by = ? THEN ?
            WHEN (lb.user_id IS NULL OR lb.user_id = 0 OR lb.user_id = '') AND lb.locked_by = 'online' THEN ?
            ELSE ?
          END
        ) * 60
      ) AS mysql_expires_at_unix,
      CASE
        WHEN lb.user_id > 0 AND lb.locked_by IN ('terminal', ?) THEN CONCAT('Admin (', a.admin_fristname, ' ', a.admin_lastname, ')'
        )
        WHEN lb.user_id > 0 AND lb.locked_by = 'online' THEN CONCAT(u.first_name, ' ', u.sur_name)
        WHEN lb.user_id = -1 AND lb.locked_by IN ('terminal', ?) THEN 'Admin'
        WHEN lb.user_id = -1 AND lb.locked_by = 'ride2' THEN 'RideTo'
        WHEN (lb.user_id IS NULL OR lb.user_id = 0 OR lb.user_id = '') AND lb.locked_by = 'online' THEN 'Guest'
        ELSE 'Admin'
      END AS user_names
    FROM lock_bookings lb
    INNER JOIN course_events ce ON ce.id = lb.event_id
    LEFT JOIN users u ON lb.user_id = u.id AND lb.locked_by = 'online'
    LEFT JOIN admin a ON lb.user_id = a.admin_id AND lb.locked_by IN ('terminal', ?)
    LEFT JOIN courses c ON c.id = ce.course_id
    LEFT JOIN locations l ON l.id = ce.location_id
    WHERE lb.delete_process = 0
    ORDER BY lb.id DESC`,
    [
      STRIPE_PAYMENT_LINK_LOCKED_BY,
      stripeMinutes,
      guestMinutes,
      adminMinutes,
      STRIPE_PAYMENT_LINK_LOCKED_BY,
      STRIPE_PAYMENT_LINK_LOCKED_BY,
      STRIPE_PAYMENT_LINK_LOCKED_BY,
    ]
  );

  const lockCreatedById = new Map();
  for (const row of rows || []) {
    const lockId = Number(row.lock_id);
    if (!lockId) continue;
    lockCreatedById.set(lockId, mysqlDateToUnix(row.booking_date));
  }

  const stripeExpiryByLock = await loadStripeExpiryByLockId(pool, lockCreatedById);

  const nowUnix = Math.floor(Date.now() / 1000);

  const bookings = (rows || []).map((row) => {
    const userLabel = row.user_names ? String(row.user_names).trim() : '';
    const evStart = row.evStart ? String(row.evStart).trim() : '';
    const evEnd = row.evEnd ? String(row.evEnd).trim() : '';
    const timeRange =
      evStart && evEnd ? `${evStart} - ${evEnd}` : evStart || evEnd || '';

    const lockId = Number(row.lock_id);
    const mysqlExpires = Number(row.mysql_expires_at_unix) || 0;
    const stripeExpires = stripeExpiryByLock.get(lockId) || 0;

    let expiresAtUnix = mysqlExpires;
    if (stripeExpires > nowUnix) {
      expiresAtUnix = stripeExpires;
    } else if (stripeExpires > 0 && mysqlExpires > stripeExpires) {
      expiresAtUnix = mysqlExpires;
    }

    return {
      lock_id: lockId,
      course_event_id: Number(row.course_event_id),
      event_date_label: formatEventDateLabel(row.evDate),
      event_time_label: timeRange,
      course_name: row.booking_course || '',
      location_name: row.booking_location || '',
      user_label: userLabel,
      locked_by: row.locked_by || '',
      payment_page_reached: Number(row.paymentStatus) === 1,
      space_required: Number(row.space_required) || 0,
      ip_address: row.ip_address || '',
      created: row.booking_date,
      expires_at_unix: expiresAtUnix,
    };
  });

  await reconcileOrphanedCurrentLocks(pool);

  return {
    bookings: bookings.filter(
      (row) => !row.expires_at_unix || row.expires_at_unix > nowUnix
    ),
  };
}

async function getActiveInProgressLockCount(pool, session) {
  const { bookings } = await getInProgressBookings(pool, session);
  return bookings.length;
}

module.exports = {
  getInProgressBookings,
  getActiveInProgressLockCount,
};
