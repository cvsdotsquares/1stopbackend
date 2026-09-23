/**
 * Admin transactions — port of legacy transactions.php / pages.class.php getTransactions.
 *
 * Performance notes:
 * - Default list must NOT join deleted_bookings (OR join blew COUNT up to ~30s+).
 * - COUNT uses the leanest joins needed for active filters.
 * - List uses payments-first (id page) then detail joins for the page rows only.
 * - Attendee join prefers primary attendee to avoid payment-row duplication.
 */
const { phpUnserialize } = require('../../utils/phpSerialize');
const {
  getTransactionTypeLabel,
  getTransactionTypeFilterOptions,
  normalizeTypeOfBookCode,
} = require('../../utils/typeOfBook');

/** Only completed / confirmed money received — no pending Stripe links or abandoned MOTO. */
const CONFIRMED_PAYMENT_SQL = `
  booking_payments.isDelete = 0
  AND booking_payments.payment_type <> 'STRIPE_LINK'
  AND COALESCE(booking_payments.transation_type, 'booking') NOT IN ('pending_link')
  AND (
    booking_payments.transation_type IN ('custom_payment', 'gift_voucher')
    OR bookings.status = 1
  )
`;

const TOB_FILTER_PAYMENT_TYPES = {
  pl: ['payment_link', 'PAYMENT_LINK'],
  bt: ['BANK_TRANSFER'],
  c: ['IN_PERSON'],
  z: ['ZERO_COST'],
  t: ['TERMINAL', 'CASH'],
  m: ['MOTO'],
};

const RECORDS_PER_PAGE = 10;

const TOB_NAME_SEARCH = {
  TERMINAL: 't',
  MOTO: 'm',
  ONLINE: 'o',
  RIDETO: 'r',
  WORLDPAY: 'w',
  'PAYMENT LINK': 'pl',
  'BANK TRANSFER': 'bt',
  'IN PERSON': 'c',
  'ZERO COST': 'z',
};

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function parseExtraInfo(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;

  const str = String(raw);
  const unserialized = phpUnserialize(str);
  if (unserialized && typeof unserialized === 'object') return unserialized;

  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_err) {
    // ignore
  }
  return null;
}

/**
 * Build WHERE + params.
 * @returns {{
 *   where: string,
 *   params: any[],
 *   needsAttendee: boolean,
 *   needsCourse: boolean,
 *   needsFranchise: boolean,
 *   needsDeletedSearch: boolean,
 * }}
 */
function buildListWhere(searchterm = {}) {
  const whereParts = [`(${CONFIRMED_PAYMENT_SQL.trim()})`];
  const params = [];
  let needsAttendee = false;
  let needsCourse = false;
  let needsFranchise = false;
  let needsDeletedSearch = false;

  const nameScr = trim(searchterm.name_scr);
  if (nameScr) {
    const upper = nameScr.toUpperCase();
    needsDeletedSearch = true;

    const tobFromName = TOB_NAME_SEARCH[upper];
    if (tobFromName) {
      const tob = tobFromName;
      needsAttendee = true;
      whereParts.push(`(
        booking_attendees.booking_ref LIKE ?
        OR bookings.type_of_book = ?
        OR EXISTS (
          SELECT 1 FROM deleted_bookings db
          WHERE db.booking_id = booking_payments.booking_id
            AND db.booking_data LIKE ?
        )
      )`);
      params.push(`%${nameScr}%`, tob, `%${nameScr}%`);
    } else {
      needsAttendee = true;
      needsCourse = true;
      needsFranchise = true;
      const amountClause = /^-?\d+(\.\d+)?$/.test(nameScr)
        ? 'OR booking_payments.amount = ?'
        : '';
      whereParts.push(`(
        booking_attendees.booking_ref LIKE ?
        OR booking_attendees.first_name LIKE ?
        OR booking_attendees.sur_name LIKE ?
        OR courses.course_name LIKE ?
        OR franchise.franchise_name LIKE ?
        OR CONCAT_WS(' ', booking_attendees.first_name, booking_attendees.sur_name) LIKE ?
        OR booking_payments.transation_extra_info LIKE ?
        OR booking_payments.custom_payment_booking_ref LIKE ?
        OR EXISTS (
          SELECT 1 FROM deleted_bookings db
          WHERE db.booking_id = booking_payments.booking_id
            AND db.booking_data LIKE ?
        )
        ${amountClause}
      )`);
      params.push(
        `%${nameScr}%`,
        `%${nameScr}%`,
        `%${nameScr}%`,
        `%${nameScr}%`,
        `%${nameScr}%`,
        `%${nameScr}%`,
        `%${nameScr}%`,
        `%${nameScr}%`,
        `%${nameScr}%`
      );
      if (/^-?\d+(\.\d+)?$/.test(nameScr)) {
        params.push(Number(nameScr));
      }
    }
  }

  const amountScr = trim(searchterm.amount_scr);
  if (amountScr && /^-?\d+(\.\d+)?$/.test(amountScr)) {
    whereParts.push('booking_payments.amount = ?');
    params.push(Number(amountScr));
  }

  const amountFromScr = trim(searchterm.amount_from_scr);
  if (amountFromScr && /^-?\d+(\.\d+)?$/.test(amountFromScr)) {
    whereParts.push('booking_payments.amount >= ?');
    params.push(Number(amountFromScr));
  }

  const amountToScr = trim(searchterm.amount_to_scr);
  if (amountToScr && /^-?\d+(\.\d+)?$/.test(amountToScr)) {
    whereParts.push('booking_payments.amount <= ?');
    params.push(Number(amountToScr));
  }

  // Prefer range predicates so created index can be used (avoid DATE()).
  const fromScr = trim(searchterm.from_scr);
  if (fromScr) {
    whereParts.push('booking_payments.created >= ?');
    params.push(`${fromScr} 00:00:00`);
  }

  const toScr = trim(searchterm.to_scr);
  if (toScr) {
    whereParts.push('booking_payments.created < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(toScr);
  }

  const tobScr = normalizeTypeOfBookCode(searchterm.tob_scr);
  if (tobScr) {
    const paymentTypes = TOB_FILTER_PAYMENT_TYPES[tobScr];
    if (tobScr === 'm') {
      whereParts.push(`(
        bookings.type_of_book = ?
        OR (
          booking_payments.transation_type = 'custom_payment'
          AND booking_payments.payment_type = 'MOTO'
        )
      )`);
      params.push(tobScr);
    } else if (paymentTypes?.length) {
      whereParts.push(
        `(bookings.type_of_book = ? OR booking_payments.payment_type IN (${paymentTypes
          .map(() => '?')
          .join(',')}))`
      );
      params.push(tobScr, ...paymentTypes);
    } else {
      whereParts.push('bookings.type_of_book = ?');
      params.push(tobScr);
    }
  }

  return {
    where: whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '',
    params,
    needsAttendee,
    needsCourse,
    needsFranchise,
    needsDeletedSearch,
  };
}

function buildFilterJoins({
  needsAttendee = false,
  needsCourse = false,
  needsFranchise = false,
} = {}) {
  const parts = [
    'FROM booking_payments',
    'LEFT JOIN bookings ON booking_payments.booking_id = bookings.id',
  ];

  if (needsAttendee) {
    // Prefer primary; if none, still allow a row via non-primary fallback in detail query.
    parts.push(
      'LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id AND booking_attendees.`primary` = 1'
    );
  }
  if (needsCourse || needsFranchise) {
    parts.push('LEFT JOIN courses ON bookings.course_id = courses.id');
  }
  if (needsFranchise) {
    parts.push(
      'LEFT JOIN course_events ON bookings.course_event_id = course_events.id'
    );
    parts.push(
      'LEFT JOIN franchise ON franchise.id = course_events.franchise_id'
    );
  }

  return `\n  ${parts.join('\n  ')}\n`;
}

const DETAIL_JOINS = `
  FROM booking_payments
  LEFT JOIN bookings ON booking_payments.booking_id = bookings.id
  LEFT JOIN booking_attendees ON booking_attendees.id = (
    SELECT ba.id
    FROM booking_attendees ba
    WHERE ba.booking_id = bookings.id
    ORDER BY ba.\`primary\` DESC, ba.id ASC
    LIMIT 1
  )
  LEFT JOIN courses ON bookings.course_id = courses.id
  LEFT JOIN course_events ON bookings.course_event_id = course_events.id
  LEFT JOIN franchise ON franchise.id = course_events.franchise_id
`;

function mapTransactionRow(row) {
  const extra = parseExtraInfo(row.transation_extra_info);
  const transactionType = row.transation_type || 'booking';

  let ref = row.booking_ref || '';
  let attendee = `${trim(row.first_name)} ${trim(row.sur_name)}`.trim();
  let course = row.course_name || '';
  let company = row.franchise_name || '';
  let tob = getTransactionTypeLabel({
    typeOfBook: row.type_of_book,
    paymentType: row.payment_type,
    transactionType,
  });
  let linkHint = null;

  if (transactionType === 'custom_payment' || transactionType === 'gift_voucher') {
    if (extra) {
      attendee = trim(extra.payee_name) || attendee;
      course = trim(extra.payment_description) || course;
      if (extra.franchise_name) {
        company = trim(extra.franchise_name);
      } else if (extra.franchise) {
        company = company || '';
      }
    }
    ref = row.custom_payment_booking_ref || ref;
    linkHint =
      transactionType === 'gift_voucher'
        ? { type: 'gift_voucher', booking_id: row.bpbid }
        : null;
  } else if (Number(row.bstatus) === 1 && Number(row.isDelete) === 0 && row.bid) {
    linkHint = { type: 'booking', booking_id: row.bid };
  }

  return {
    id: row.bpid,
    booking_id: row.bid,
    payment_booking_id: row.bpbid,
    ref,
    attendee,
    tob,
    amount: Number(row.amount) || 0,
    course,
    company,
    status: 'Confirmed',
    booking_status: row.bstatus == null ? null : Number(row.bstatus),
    isDelete: Number(row.isDelete) || 0,
    transaction_type: transactionType,
    payment_type: row.payment_type || '',
    transaction_date: row.bcreated,
    extra_info: extra,
    link_hint: linkHint,
  };
}

async function resolveFranchiseNames(pool, items) {
  const ids = new Set();
  for (const item of items) {
    const fid = item.extra_info?.franchise;
    if (fid && !item.company) ids.add(Number(fid));
  }
  if (!ids.size) return items;

  const idList = [...ids].filter((n) => Number.isFinite(n) && n > 0);
  if (!idList.length) return items;

  const [rows] = await pool.query(
    `SELECT id, franchise_name FROM franchise WHERE id IN (${idList.map(() => '?').join(',')})`,
    idList
  );
  const map = new Map((rows || []).map((r) => [Number(r.id), r.franchise_name]));
  return items.map((item) => {
    const fid = Number(item.extra_info?.franchise);
    if (fid && !item.company && map.has(fid)) {
      return { ...item, company: map.get(fid) };
    }
    return item;
  });
}

async function listTransactions(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const {
    where,
    params,
    needsAttendee,
    needsCourse,
    needsFranchise,
  } = buildListWhere(searchterm);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const filterJoins = buildFilterJoins({
    needsAttendee,
    needsCourse,
    needsFranchise,
  });

  // Lean COUNT: never join deleted_bookings (search uses EXISTS instead).
  const [countRows] = await pool.query(
    `SELECT COUNT(DISTINCT booking_payments.id) AS total ${filterJoins} ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  // Payments-first page of IDs, then hydrate details for those rows only.
  const [idRows] = await pool.query(
    `SELECT DISTINCT booking_payments.id AS id
     ${filterJoins}
     ${where}
     ORDER BY booking_payments.id DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  const ids = (idRows || []).map((r) => Number(r.id)).filter((n) => n > 0);
  let rows = [];
  if (ids.length) {
    const [detailRows] = await pool.query(
      `SELECT
         booking_attendees.booking_ref,
         booking_payments.amount,
         booking_payments.isDelete,
         booking_attendees.first_name,
         courses.course_name,
         booking_attendees.sur_name,
         bookings.type_of_book,
         franchise.franchise_name,
         booking_payments.id AS bpid,
         bookings.id AS bid,
         bookings.status AS bstatus,
         booking_payments.created AS bcreated,
         booking_payments.booking_id AS bpbid,
         booking_payments.transation_type,
         booking_payments.transation_extra_info,
         booking_payments.custom_payment_booking_ref,
         booking_payments.payment_type
       ${DETAIL_JOINS}
       WHERE booking_payments.id IN (${ids.map(() => '?').join(',')})
       ORDER BY booking_payments.id DESC`,
      ids
    );
    rows = detailRows || [];
  }

  let items = rows.map(mapTransactionRow);
  items = await resolveFranchiseNames(pool, items);

  return {
    items,
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE) || 1),
    },
    filters: {
      name_scr: trim(searchterm.name_scr),
      from_scr: trim(searchterm.from_scr),
      to_scr: trim(searchterm.to_scr),
      tob_scr: trim(searchterm.tob_scr),
      amount_scr: trim(searchterm.amount_scr),
      amount_from_scr: trim(searchterm.amount_from_scr),
      amount_to_scr: trim(searchterm.amount_to_scr),
    },
    typeOptions: getTransactionTypeFilterOptions(),
  };
}

async function deleteTransaction(pool, id) {
  const paymentId = Number(id);
  if (!Number.isFinite(paymentId) || paymentId <= 0) {
    return { ok: false, message: 'Transaction not found to delete' };
  }

  const [existing] = await pool.query(
    'SELECT id FROM booking_payments WHERE id = ? LIMIT 1',
    [paymentId]
  );
  if (!existing?.length) {
    return { ok: false, message: 'Transaction not found to delete' };
  }

  const [result] = await pool.query('DELETE FROM booking_payments WHERE id = ?', [
    paymentId,
  ]);
  if (!result?.affectedRows) {
    return { ok: false, message: 'Error in deleting transaction' };
  }

  return { ok: true, message: 'Transaction deleted successfully.' };
}

module.exports = {
  listTransactions,
  deleteTransaction,
  parseExtraInfo,
  RECORDS_PER_PAGE,
};
