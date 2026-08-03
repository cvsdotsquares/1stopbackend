/**
 * Header booking ref search (legacy search_results.php).
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

async function getFranchiseRefConditions(pool, idParam) {
  const [prefixRows] = await pool.query(
    "SELECT inv_prefix FROM franchise WHERE inv_prefix != '' AND inv_prefix != '1SRC'"
  );
  const clauses = [
    'CAST(booking_attendees.booking_id AS CHAR) = ?',
    'booking_attendees.booking_ref = ?',
    "booking_attendees.booking_ref = CONCAT('1SRC', ?)",
  ];
  const params = [idParam, idParam, idParam];
  for (const row of prefixRows || []) {
    const prefix = trim(row.inv_prefix);
    if (prefix) {
      clauses.push('booking_attendees.booking_ref = ?');
      params.push(`${prefix}${idParam}`);
    }
  }
  return { where: `(${clauses.join(' OR ')})`, params };
}

async function resolveHeaderBookingSearch(pool, idRaw) {
  const sid = trim(idRaw);
  if (!sid) {
    const err = new Error('Booking not found to view');
    err.status = 404;
    throw err;
  }

  const [giftRows] = await pool.query(
    `SELECT id FROM gift_voucher
     WHERE CAST(bid AS CHAR) = ? OR voucher_ref = ?
     LIMIT 1`,
    [sid, sid]
  );
  if (giftRows?.[0]) {
    return {
      type: 'gift_voucher',
      id: sid,
      redirect_path: `/admin/coming-soon?feature=F-039&id=${encodeURIComponent(sid)}`,
    };
  }

  const { where, params } = await getFranchiseRefConditions(pool, sid);
  const [bookingRows] = await pool.query(
    `SELECT booking_attendees.booking_id
     FROM booking_attendees
     LEFT JOIN bookings ON booking_attendees.booking_id = bookings.id
     WHERE ${where}
     ORDER BY booking_attendees.\`primary\` DESC
     LIMIT 1`,
    params
  );

  const bookingId = bookingRows?.[0]?.booking_id;
  if (!bookingId) {
    const err = new Error('Booking not found to view');
    err.status = 404;
    throw err;
  }

  return {
    type: 'booking',
    booking_id: Number(bookingId),
    redirect_path: `/admin/bookings/${bookingId}`,
  };
}

module.exports = { resolveHeaderBookingSearch };
