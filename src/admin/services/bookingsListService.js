const RECORDS_PER_PAGE = 10;

const TOB_LABELS = {
  m: 'MOTO',
  o: 'Online',
  t: 'Terminal',
  w: 'Worldpay',
  r: 'RideTo',
};

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function paginationMeta(page, perPage, total) {
  const pageNum = Math.max(1, Number(page) || 1);
  return {
    page: pageNum,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

function formatUkDate(value) {
  if (value == null || value === '' || value === '0000-00-00') return 'TBC';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = String(value.getDate()).padStart(2, '0');
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const y = value.getFullYear();
    if (y < 1900) return 'TBC';
    return `${d}/${m}/${y}`;
  }
  const s = String(value);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return s;
  if (iso[1] === '0000') return 'TBC';
  return `${iso[3]}/${iso[2]}/${iso[1]}`;
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

function deriveBookingDisplayStatus(booking) {
  if (Number(booking.on_hold) === 1) {
    return 'On Hold';
  }
  if (Number(booking.status) === 2) {
    return 'Refunded';
  }
  if (Number(booking.status) === 1 && Number(booking.refundable) === 0) {
    return 'Confirmed';
  }
  if (Number(booking.status) === 1 && Number(booking.refundable) === 1) {
    return 'Over Booking';
  }
  return 'In Process';
}

function buildStatusFilter(statusScr) {
  const key = trim(statusScr).toLowerCase();
  switch (key) {
    case 'confirmed':
      return ' AND bookings.status = 1 AND bookings.refundable = 0 AND IFNULL(bookings.on_hold, 0) = 0 ';
    case 'on_hold':
      return ' AND IFNULL(bookings.on_hold, 0) = 1 ';
    case 'overbooking':
      return ' AND bookings.status = 1 AND bookings.refundable = 1 ';
    case 'refunded':
      return ' AND bookings.status = 2 ';
    case 'in_process':
      return ' AND bookings.status = 0 ';
    default:
      return '';
  }
}

async function listBookings(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const nameScr = trim(searchterm?.name_scr);
  const statusScr = trim(searchterm?.status_scr);

  let where = ' WHERE bookings.status != 5 ';
  const params = [];

  where += buildStatusFilter(statusScr);

  if (nameScr) {
    const like = `%${nameScr}%`;
    where += ` AND (
      booking_attendees.booking_ref LIKE ?
      OR booking_attendees.first_name LIKE ?
      OR booking_attendees.sur_name LIKE ?
      OR booking_attendees.email LIKE ?
      OR booking_attendees.contact1 = ?
      OR booking_attendees.contact2 = ?
      OR booking_attendees.contact3 = ?
      OR CONCAT(booking_attendees.first_name, ' ', booking_attendees.sur_name) LIKE ?
      OR courses.course_name LIKE ?
      OR courses.course_abb LIKE ?
      OR locations.location_name LIKE ?
    )`;
    params.push(
      like,
      like,
      like,
      like,
      nameScr,
      nameScr,
      nameScr,
      like,
      like,
      like,
      like
    );
  }

  const fromJoin = `
    FROM bookings
    INNER JOIN booking_attendees
      ON booking_attendees.booking_id = bookings.id
     AND booking_attendees.\`primary\` = 1
    LEFT JOIN courses ON courses.id = bookings.course_id
    LEFT JOIN course_events ON course_events.id = bookings.course_event_id
    LEFT JOIN locations ON locations.id = course_events.location_id
    LEFT JOIN (
      SELECT course_event_id, MIN(event_date) AS event_date
      FROM course_event_dates
      GROUP BY course_event_id
    ) AS course_event_dates
      ON course_event_dates.course_event_id = bookings.course_event_id
  `;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total ${fromJoin} ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const [rows] = await pool.query(
    `SELECT
        bookings.id,
        bookings.course_event_id,
        bookings.status,
        bookings.refundable,
        bookings.total_amount,
        bookings.payment_due,
        bookings.type_of_book,
        bookings.created,
        IFNULL(bookings.on_hold, 0) AS on_hold,
        booking_attendees.booking_ref,
        booking_attendees.first_name,
        booking_attendees.sur_name,
        courses.course_name,
        courses.course_abb,
        locations.location_name,
        course_event_dates.event_date AS course_date
     ${fromJoin}
     ${where}
     ORDER BY bookings.created DESC, bookings.id DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  const items = (rows || []).map((row) => ({
    id: Number(row.id),
    course_event_id: Number(row.course_event_id) || 0,
    booking_ref: row.booking_ref || '',
    attendee_name: `${trim(row.first_name)} ${trim(row.sur_name)}`.trim(),
    course_name: row.course_name || '',
    course_abb: row.course_abb || '',
    location_name: row.location_name || '',
    course_date: formatUkDate(row.course_date),
    status: Number(row.status),
    refundable: Number(row.refundable),
    display_status: deriveBookingDisplayStatus(row),
    on_hold: Number(row.on_hold) === 1,
    type_of_book: row.type_of_book || '',
    type_of_book_label: TOB_LABELS[row.type_of_book] || row.type_of_book || '',
    total_amount: row.total_amount,
    payment_due: row.payment_due,
    amount_paid:
      Number(row.total_amount || 0) - Number(row.payment_due || 0),
    created: row.created,
    created_label: formatBookingCreated(row.created),
    can_edit:
      Number(row.status) === 1 &&
      Number(row.refundable) === 0 &&
      Number(row.on_hold) !== 1,
    can_refund: Number(row.refundable) === 1 && Number(row.on_hold) !== 1,
    can_delete:
      Number(row.status) === 1 &&
      Number(row.refundable) === 0 &&
      Number(row.on_hold) !== 1,
    can_hold:
      Number(row.status) === 1 &&
      Number(row.refundable) === 0 &&
      Number(row.on_hold) !== 1,
    can_reinstate: Number(row.on_hold) === 1,
  }));

  return {
    items,
    pagination: paginationMeta(pageNum, RECORDS_PER_PAGE, total),
    filters: {
      name_scr: nameScr,
      status_scr: statusScr,
    },
  };
}

module.exports = {
  listBookings,
};
