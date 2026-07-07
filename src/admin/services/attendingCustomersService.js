const { getResultLabels } = require('./deletedBookingsService');

const RECORDS_PER_PAGE = 10;

const BASE_FROM = `
  FROM booking_attendees
  LEFT JOIN bookings ON booking_attendees.booking_id = bookings.id
  LEFT JOIN courses ON bookings.course_id = courses.id
  LEFT JOIN course_event_dates ON bookings.course_event_id = course_event_dates.course_event_id`;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function buildListWhere(nameScr) {
  const term = trim(nameScr);
  const where = " WHERE booking_attendees.id != '' AND bookings.status IN (1, 2)";
  if (!term) {
    return { where, params: [] };
  }

  return {
    where: `${where} AND (
      booking_attendees.booking_ref = ?
      OR booking_attendees.first_name LIKE ?
      OR booking_attendees.sur_name LIKE ?
      OR booking_attendees.email LIKE ?
      OR booking_attendees.contact1 = ?
      OR booking_attendees.contact2 = ?
      OR booking_attendees.contact3 = ?
      OR CONCAT_WS(' ', TRIM(booking_attendees.first_name), TRIM(booking_attendees.sur_name)) LIKE ?
    )`,
    params: [
      term,
      `%${term}%`,
      `%${term}%`,
      `%${term}%`,
      term,
      term,
      term,
      `%${term}%`,
    ],
  };
}

async function listAttendingCustomers(pool, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const { where, params } = buildListWhere(query.name_scr);
  const offset = (page - 1) * RECORDS_PER_PAGE;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total ${BASE_FROM}${where}`,
    params
  );
  const total = Number(countRows[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT booking_attendees.*,
      bookings.id AS bid,
      bookings.course_id,
      bookings.course_event_id,
      courses.course_abb,
      course_event_dates.event_date
     ${BASE_FROM}
     ${where}
     ORDER BY booking_attendees.id DESC
     LIMIT ? OFFSET ?`,
    [...params, RECORDS_PER_PAGE, offset]
  );

  const items = [];
  const bookingIds = [];

  for (const row of rows || []) {
    if (!row?.id || !row?.bid) {
      continue;
    }

    const bookingId = Number(row.bid);
    bookingIds.push(bookingId);

    items.push({
      attendee_id: Number(row.id),
      booking_id: bookingId,
      booking_ref: trim(row.booking_ref),
      first_name: trim(row.first_name),
      sur_name: trim(row.sur_name),
      course_abb: trim(row.course_abb),
      event_date: row.event_date ? String(row.event_date).slice(0, 10) : '',
      license_number: trim(row.license_number),
      email: trim(row.email),
      contact1: trim(row.contact1),
      contact2: trim(row.contact2),
      contact3: trim(row.contact3),
      result: 'Not yet submitted',
    });
  }

  const resultMap = await getResultLabels(pool, bookingIds);
  for (const item of items) {
    if (resultMap[item.booking_id]) {
      item.result = resultMap[item.booking_id];
    }
  }

  return {
    items,
    pagination: {
      page,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
  };
}

module.exports = {
  listAttendingCustomers,
};
