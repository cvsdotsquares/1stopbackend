/**
 * Reserve booking IDs + refs while admin lock is active (20 min hold).
 * Same refs are finalized when the wizard is submitted.
 */
const { LOCK_EXPIRE_TIME_MINUTES } = require('../constants');

async function loadEventForReserve(pool, eventId) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const [rows] = await pool.query(
    `SELECT ce.id, ce.course_id, ce.franchise_id
     FROM course_events ce
     WHERE ce.id = ?
     LIMIT 1`,
    [id]
  );
  return rows?.[0] || null;
}

async function bookingRefNo(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT franchise.inv_prefix
     FROM bookings
     LEFT JOIN course_events ON course_events.id = bookings.course_event_id
     LEFT JOIN franchise ON franchise.id = course_events.franchise_id
     WHERE bookings.id = ?
     LIMIT 1`,
    [bookingId]
  );
  const prefix = rows?.[0]?.inv_prefix;
  return prefix ? `${prefix}${bookingId}` : `1SRC${bookingId}`;
}

async function listReservedBookingsForLock(pool, lockId) {
  const id = Number(lockId);
  if (!Number.isFinite(id) || id <= 0) return [];

  const [rows] = await pool.query(
    `SELECT b.id AS booking_id, MIN(ba.booking_ref) AS booking_ref
     FROM bookings b
     INNER JOIN booking_attendees ba ON ba.booking_id = b.id
     WHERE b.lockid = ?
       AND b.booking_made_by = 'admin'
       AND b.status = 0
     GROUP BY b.id
     ORDER BY b.id ASC`,
    [id]
  );
  return (rows || []).map((row) => ({
    booking_id: Number(row.booking_id),
    booking_ref: String(row.booking_ref || '').trim(),
  }));
}

async function deleteReservedBookingsForLock(pool, lockId) {
  const id = Number(lockId);
  if (!Number.isFinite(id) || id <= 0) return;

  const [rows] = await pool.query(
    `SELECT id FROM bookings
     WHERE lockid = ? AND booking_made_by = 'admin' AND status = 0`,
    [id]
  );
  const bookingIds = (rows || []).map((r) => Number(r.id)).filter((n) => n > 0);
  if (!bookingIds.length) return;

  await pool.query(
    `DELETE FROM booking_attendees WHERE booking_id IN (${bookingIds.map(() => '?').join(',')})`,
    bookingIds
  );
  await pool.query(
    `DELETE FROM booking_payments WHERE booking_id IN (${bookingIds.map(() => '?').join(',')})`,
    bookingIds
  );
  await pool.query(
    `DELETE FROM bookings WHERE id IN (${bookingIds.map(() => '?').join(',')})`,
    bookingIds
  );
}

async function createPlaceholderBooking(pool, { event, lockId, adminId }) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const [insertResult] = await pool.query(
    `INSERT INTO bookings
      (course_id, course_event_id, user_id, booking_made_by_id, booking_made_by,
       type_of_book, spaces, payment_due, total_fees, vatrate, vat, total_amount,
       status, lockid, created, modified, admin_payment_received)
     VALUES (?, ?, 0, ?, 'admin', 't', 1, 0, 0, 0, 0, 0, 0, ?, ?, ?, 0)`,
    [
      event.course_id,
      event.id,
      Number(adminId) || 0,
      Number(lockId) || 0,
      now,
      now,
    ]
  );
  const bookingId = insertResult.insertId;
  const bookingRef = await bookingRefNo(pool, bookingId);
  await pool.query(
    `INSERT INTO booking_attendees
      (booking_ref, booking_id, first_name, sur_name, \`primary\`, created)
     VALUES (?, ?, '', '', 1, ?)`,
    [bookingRef, bookingId, now]
  );
  return { booking_id: bookingId, booking_ref: bookingRef };
}

/**
 * Ensure one placeholder booking + ref per seat on the active lock.
 */
async function ensureReservedBookingsForLock(
  pool,
  { eventId, lockId, spaceRequired, adminId }
) {
  const evId = Number(eventId);
  const lock = Number(lockId);
  const spaces = Math.max(0, Number(spaceRequired) || 0);
  if (!Number.isFinite(evId) || evId <= 0 || !Number.isFinite(lock) || lock <= 0) {
    return [];
  }
  if (spaces <= 0) {
    await deleteReservedBookingsForLock(pool, lock);
    return [];
  }

  const event = await loadEventForReserve(pool, evId);
  if (!event) return [];

  let reserved = await listReservedBookingsForLock(pool, lock);

  while (reserved.length > spaces) {
    const drop = reserved.pop();
    if (drop?.booking_id) {
      await pool.query('DELETE FROM booking_attendees WHERE booking_id = ?', [
        drop.booking_id,
      ]);
      await pool.query('DELETE FROM booking_payments WHERE booking_id = ?', [
        drop.booking_id,
      ]);
      await pool.query('DELETE FROM bookings WHERE id = ? AND status = 0', [
        drop.booking_id,
      ]);
    }
  }

  while (reserved.length < spaces) {
    const created = await createPlaceholderBooking(pool, {
      event,
      lockId: lock,
      adminId,
    });
    reserved.push(created);
  }

  return listReservedBookingsForLock(pool, lock);
}

function mergeReservedRefsIntoSavedAttendees(savedAttendees, reserved) {
  const out =
    savedAttendees && typeof savedAttendees === 'object'
      ? { ...savedAttendees }
      : {};
  for (let i = 0; i < reserved.length; i += 1) {
    const key = String(i + 1);
    const ref = reserved[i]?.booking_ref;
    if (!ref) continue;
    const prev = out[key];
    out[key] =
      prev && typeof prev === 'object'
        ? { ...prev, booking_ref: ref }
        : { booking_ref: ref };
  }
  return out;
}

/**
 * Remove admin placeholder bookings whose hold ended (lock gone/expired/deleted).
 * Does not touch Stripe payment-link holds (non-terminal locked_by).
 */
async function cleanupOrphanAdminPlaceholderBookings(pool) {
  const minutes = Number(LOCK_EXPIRE_TIME_MINUTES) || 20;
  const [rows] = await pool.query(
    `SELECT b.id
     FROM bookings b
     LEFT JOIN lock_bookings lb ON lb.id = b.lockid
     WHERE b.booking_made_by = 'admin'
       AND b.status = 0
       AND (
         b.lockid = 0
         OR lb.id IS NULL
         OR lb.delete_process = 1
         OR (
           lb.locked_by = 'terminal'
           AND NOW() >= (lb.created + INTERVAL ? MINUTE)
         )
       )`,
    [minutes]
  );
  const bookingIds = (rows || []).map((r) => Number(r.id)).filter((n) => n > 0);
  if (!bookingIds.length) return 0;

  await pool.query(
    `DELETE FROM booking_attendees WHERE booking_id IN (${bookingIds.map(() => '?').join(',')})`,
    bookingIds
  );
  await pool.query(
    `DELETE FROM booking_payments WHERE booking_id IN (${bookingIds.map(() => '?').join(',')})`,
    bookingIds
  );
  await pool.query(
    `DELETE FROM bookings WHERE id IN (${bookingIds.map(() => '?').join(',')})`,
    bookingIds
  );
  return bookingIds.length;
}

module.exports = {
  listReservedBookingsForLock,
  ensureReservedBookingsForLock,
  deleteReservedBookingsForLock,
  cleanupOrphanAdminPlaceholderBookings,
  mergeReservedRefsIntoSavedAttendees,
  bookingRefNo,
};
