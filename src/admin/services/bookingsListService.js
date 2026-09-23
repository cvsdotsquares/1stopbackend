const { isEventDatePassed } = require('./adminBookingHoldService');
const { getTransactionTypeLabel } = require('../../utils/typeOfBook');
const {
  getExpireMinutes,
  getExpireGraceMs,
  PENDING_PAYMENT_TYPE,
} = require('./bookingStripeLinkService');

const RECORDS_PER_PAGE = 10;
const COMPLETED_PL_PAYMENT_TYPE = 'payment_link';

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

function parseStripeLinkExpiresMs(paymentRow) {
  if (!paymentRow?.response) return null;
  try {
    const parsed =
      typeof paymentRow.response === 'string'
        ? JSON.parse(paymentRow.response)
        : paymentRow.response;
    if (parsed?.expires_at) {
      const ms = Date.parse(parsed.expires_at);
      if (Number.isFinite(ms)) return ms;
    }
  } catch {
    /* ignore */
  }
  if (!paymentRow.payment_created) return null;
  const created = new Date(paymentRow.payment_created);
  if (Number.isNaN(created.getTime())) return null;
  return created.getTime() + getExpireMinutes() * 60 * 1000;
}

function isExpiredAdminStripePaymentLink(booking, paymentRow) {
  if (Number(booking.status) !== 0) return false;
  const pt = trim(paymentRow?.payment_type).toUpperCase();
  if (pt !== PENDING_PAYMENT_TYPE && pt !== 'STRIPE_LINK') return false;
  const expiresMs = parseStripeLinkExpiresMs(paymentRow);
  if (!expiresMs) return false;
  return Date.now() > expiresMs + getExpireGraceMs();
}

function deriveBookingDisplayStatus(booking, { expiredPaymentLink } = {}) {
  if (expiredPaymentLink) {
    return 'Expired';
  }
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

function resolveBookedLabel(booking, paymentRow, expiredPaymentLink) {
  if (expiredPaymentLink) return '';
  const pt = trim(paymentRow?.payment_type).toLowerCase();
  if (
    Number(booking.status) === 1 &&
    (pt === COMPLETED_PL_PAYMENT_TYPE || pt === 'payment_link') &&
    paymentRow?.payment_created
  ) {
    return formatBookingCreated(paymentRow.payment_created);
  }
  return formatBookingCreated(booking.created);
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

  // Confirmed / on-hold / refunded only — unpaid (status 0) live on In Progress page.
  let where = ' WHERE bookings.status != 5 AND bookings.status != 0 ';
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
      SELECT
        course_event_id,
        MIN(event_date) AS event_date,
        MAX(
          CASE
            WHEN event_date > '1900-01-01'
             AND event_date NOT IN ('1111-11-11', '0000-00-00')
            THEN event_date
          END
        ) AS latest_event_date
      FROM course_event_dates
      GROUP BY course_event_id
    ) AS course_event_dates
      ON course_event_dates.course_event_id = bookings.course_event_id
    LEFT JOIN booking_payments AS latest_payment
      ON latest_payment.id = (
        SELECT bp.id
        FROM booking_payments bp
        WHERE bp.booking_id = bookings.id
          AND (bp.isDelete IS NULL OR bp.isDelete = 0)
        ORDER BY bp.id DESC
        LIMIT 1
      )
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
        course_event_dates.event_date AS course_date,
        course_event_dates.latest_event_date,
        latest_payment.payment_type AS latest_payment_type,
        latest_payment.created AS latest_payment_created,
        latest_payment.response AS latest_payment_response
     ${fromJoin}
     ${where}
     ORDER BY bookings.created DESC, bookings.id DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  const items = (rows || []).map((row) => {
      const paymentRow = {
        payment_type: row.latest_payment_type,
        payment_created: row.latest_payment_created,
        response: row.latest_payment_response,
      };
      const expiredPaymentLink = isExpiredAdminStripePaymentLink(row, paymentRow);
      const eventDatePassed = isEventDatePassed(row.latest_event_date);
      const showActions = !expiredPaymentLink;

      return {
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
        display_status: deriveBookingDisplayStatus(row, { expiredPaymentLink }),
        on_hold: Number(row.on_hold) === 1,
        is_expired_payment_link: expiredPaymentLink,
        can_link_ref: !expiredPaymentLink,
        show_actions: showActions,
        type_of_book: row.type_of_book || '',
        type_of_book_label: getTransactionTypeLabel({
          typeOfBook: row.type_of_book,
          paymentType: row.latest_payment_type,
          transactionType: 'booking',
        }),
        total_amount: row.total_amount,
        payment_due: row.payment_due,
        amount_paid:
          Number(row.total_amount || 0) - Number(row.payment_due || 0),
        created: row.created,
        created_label: resolveBookedLabel(row, paymentRow, expiredPaymentLink),
        can_edit:
          showActions &&
          Number(row.status) === 1 &&
          Number(row.refundable) === 0 &&
          Number(row.on_hold) !== 1,
        can_refund:
          showActions && Number(row.refundable) === 1 && Number(row.on_hold) !== 1,
        can_delete:
          showActions &&
          Number(row.status) === 1 &&
          Number(row.refundable) === 0 &&
          Number(row.on_hold) !== 1,
        can_hold:
          showActions &&
          Number(row.status) === 1 &&
          Number(row.refundable) === 0 &&
          Number(row.on_hold) !== 1 &&
          !eventDatePassed,
        can_reinstate: showActions && Number(row.on_hold) === 1,
      };
  });

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
