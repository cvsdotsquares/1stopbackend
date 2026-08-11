const { removeExpirelocks } = require('./bookingService');
const { LOCK_EXPIRE_TIME_MINUTES } = require('../constants');
const { phpSerialize } = require('../../utils/phpSerialize');
const {
  checkAdminBookingPromoCode,
  cancelAdminBookingPromoCode,
  syncAdminOriginalAmount,
  showDepositPrice,
} = require('./adminBookingPromoService');

const TBC_DATE = '0000-00-00';

const VEHICLE_TYPE_LABELS = {
  0: 'Manual',
  1: 'Automatic',
  3: 'I will be using my own vehicle',
};

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

function titleCase(value) {
  const s = trim(value);
  if (!s) return '';
  return s.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

function ensureAdminBookingSession(session) {
  if (!session) return null;
  if (!session.adminBooking) session.adminBooking = {};
  return session.adminBooking;
}

function requireActiveBookingSession(session) {
  const adminBooking = ensureAdminBookingSession(session);
  if (
    !adminBooking?.eventId ||
    !adminBooking?.space_required ||
    !adminBooking?.lock_session?.id
  ) {
    const err = new Error('Invalid course, Try again');
    err.status = 400;
    throw err;
  }
  return adminBooking;
}

function toMysqlDateParts(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateOfBirth(value) {
  const raw = trim(value);
  if (!raw || raw === '0000-00-00') return '';
  if (raw.includes('/')) {
    const [d, m, y] = raw.split('/');
    if (d && m && y) {
      return `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toMysqlDateParts(value);
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return toMysqlDateParts(parsed);
  }
  return '';
}

function formatDateOfBirthDisplay(value) {
  if (!value || value === '0000-00-00') return '';

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
  }

  const raw = trim(String(value));
  if (!raw) return '';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split('/');
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d)}/${pad(m)}/${y}`;
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
  }

  return raw;
}

function buildEventDatesMap(dateRows) {
  const dates = {};
  let hasTbc = false;
  for (const row of dateRows || []) {
    const key = toDateKey(row.event_date);
    if (key && key !== 'TBC') {
      dates[key] =
        `${row.event_start_time || ''} - ${row.event_end_time || ''}`;
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
  return depositCalDate.toISOString().slice(0, 10) > firstDate;
}

function formatLongDate(value) {
  if (!value || value === TBC_DATE || value === 'TBC') return 'TBC';
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
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

function buildVehicleTypeOptions(event, lockSession) {
  const manOld = Number(lockSession?.manual_lock || 0);
  const autoOld = Number(lockSession?.automatic_lock || 0);
  const options = [];

  if (
    Number(event.vehicle_type_automatic) > 0 &&
    Number(event.vehicle_type_automatic) >
      Number(event.automatic_lock_done || 0) - autoOld
  ) {
    options.push({ value: 1, label: VEHICLE_TYPE_LABELS[1] });
  }
  if (
    Number(event.vehicle_type_manual) > 0 &&
    Number(event.vehicle_type_manual) > Number(event.manual_lock_done || 0) - manOld
  ) {
    options.push({ value: 0, label: VEHICLE_TYPE_LABELS[0] });
  }
  if (Number(event.vehicle_type_own) === 1) {
    options.push({ value: 3, label: VEHICLE_TYPE_LABELS[3] });
  }
  return options;
}

function getPricingForVehicle(event, showCancellation, vehicleType) {
  const isOwn = Number(vehicleType) === 3;
  const oneOff = isOwn
    ? Number(event.own_one_off_price) || 0
    : Number(event.school_one_off_price) || 0;
  const total = isOwn
    ? Number(event.own_total_price) || 0
    : Number(event.school_total_price) || 0;
  const deposit = isOwn
    ? Number(event.own_deposit_price) || 0
    : Number(event.school_deposit_price) || 0;

  if (oneOff > 0) {
    return {
      course_cost: oneOff,
      payment_received: oneOff,
      amount_outstanding: 0,
      pricing_mode: 'oneoff',
    };
  }

  if (showCancellation) {
    return {
      course_cost: total,
      payment_received: total,
      amount_outstanding: 0,
      pricing_mode: 'deposit_full',
    };
  }

  return {
    course_cost: total,
    payment_received: deposit,
    amount_outstanding: Math.max(0, total - deposit),
    pricing_mode: 'deposit',
  };
}

function getDefaultAttendeePricing(event, showCancellation) {
  const hasSchool =
    Number(event.vehicle_type_manual) > 0 ||
    Number(event.vehicle_type_automatic) > 0;
  const vehicleType = hasSchool ? 0 : 3;
  return getPricingForVehicle(event, showCancellation, vehicleType);
}

function getVehiclePricingMap(event, showCancellation) {
  const map = {};
  for (const vt of [0, 1, 3]) {
    map[vt] = getPricingForVehicle(event, showCancellation, vt);
  }
  return map;
}

function parseMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(raw)) {
    const d = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getLockExpiryIso(lockSession, lockCountdown) {
  if (lockCountdown) {
    return new Date(
      (Number(lockCountdown) + LOCK_EXPIRE_TIME_MINUTES * 60) * 1000
    ).toISOString();
  }
  const created = parseMysqlDateTime(lockSession?.created);
  if (created) {
    return new Date(
      created.getTime() + LOCK_EXPIRE_TIME_MINUTES * 60 * 1000
    ).toISOString();
  }
  return null;
}

function firstEventDateFromDates(dates) {
  const keys = Object.keys(dates || {}).filter((k) => k !== 'TBC').sort();
  return keys[0] || null;
}
async function getEventContext(pool, eventId) {
  const [rows] = await pool.query(
    `SELECT course_events.*,
            courses.course_name,
            courses.description,
            courses.deposit_days,
            courses.cancel_days,
            courses.cancel_price,
            courses.dsa_fees,
            locations.location_name,
            locations.address1,
            locations.address2,
            locations.address3,
            locations.address4,
            locations.postcode,
            franchise.franchise_name,
            franchise.vat AS franchise_vat
     FROM course_events
     LEFT JOIN courses ON courses.id = course_events.course_id
     LEFT JOIN locations ON locations.id = course_events.location_id
     LEFT JOIN franchise ON franchise.id = course_events.franchise_id
     WHERE course_events.id = ?
     LIMIT 1`,
    [eventId]
  );
  return rows?.[0] || null;
}

async function getLicenceTypes(pool) {
  const [rows] = await pool.query(
    'SELECT id, licence_type FROM driving_licence_types WHERE status = 1 ORDER BY id ASC'
  );
  return (rows || []).map((row) => ({
    value: Number(row.id),
    label: row.licence_type,
  }));
}

function formatCustomerLabel(row) {
  return [
    trim(row.first_name),
    trim(row.sur_name),
    trim(row.contact1),
    trim(row.email),
    trim(row.license_number),
  ]
    .filter(Boolean)
    .join(', ');
}

async function searchExistingCustomers(
  pool,
  { q = '', offset = 0, limit = 50 } = {}
) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const fetchLimit = safeLimit + 1;

  let where = "WHERE booking_attendees.id != ''";
  const params = [];

  const term = trim(q);
  if (term) {
    const like = `%${term}%`;
    where += ` AND (
      booking_attendees.first_name LIKE ?
      OR booking_attendees.sur_name LIKE ?
      OR booking_attendees.email LIKE ?
      OR booking_attendees.contact1 LIKE ?
      OR booking_attendees.contact2 LIKE ?
      OR booking_attendees.contact3 LIKE ?
      OR booking_attendees.license_number LIKE ?
      OR CONCAT(booking_attendees.first_name, ' ', booking_attendees.sur_name) LIKE ?
    )`;
    params.push(like, like, like, like, like, like, like, like);
  }

  const [rows] = await pool.query(
    `SELECT booking_attendees.id AS uid,
            booking_attendees.first_name,
            booking_attendees.sur_name,
            booking_attendees.contact1,
            booking_attendees.email,
            booking_attendees.license_number
     FROM booking_attendees_dropdown AS booking_attendees
     ${where}
     ORDER BY booking_attendees.first_name ASC,
              booking_attendees.sur_name ASC,
              booking_attendees.id ASC
     LIMIT ? OFFSET ?`,
    [...params, fetchLimit, safeOffset]
  );

  const list = rows || [];
  const hasMore = list.length > safeLimit;
  const items = list.slice(0, safeLimit).map((row) => ({
    id: row.uid,
    label: formatCustomerLabel(row),
  }));

  return {
    items,
    has_more: hasMore,
    offset: safeOffset,
    limit: safeLimit,
  };
}

async function getContactCard(pool, userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const [dropdownRows] = await pool.query(
    'SELECT * FROM booking_attendees_dropdown WHERE id = ? LIMIT 1',
    [id]
  );
  if (dropdownRows?.[0]) {
    const row = dropdownRows[0];
    return {
      ...row,
      date_of_birth: formatDateOfBirthDisplay(row.date_of_birth),
    };
  }

  const [userRows] = await pool.query(
    'SELECT * FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  if (userRows?.[0]) {
    const row = userRows[0];
    return {
      ...row,
      date_of_birth: formatDateOfBirthDisplay(row.date_of_birth),
    };
  }
  return null;
}

async function checkBlacklisted(pool, licenseNumber) {
  const license = trim(licenseNumber);
  if (!license) return null;
  const [rows] = await pool.query(
    `SELECT * FROM booking_attendees_dropdown
     WHERE id != '' AND is_blacklisted = 1 AND license_number = ?
     LIMIT 1`,
    [license]
  );
  return rows?.[0] || null;
}

function getVatRate(session) {
  const settings = session?.settings || {};
  return Number(settings.vat_rate || 0) || 0;
}

function computeVat(amount, event, vatRate) {
  // Legacy Booking::getEvent() SELECT * — vat comes from franchise, not course_events
  const vatEnabled = Number(event.franchise_vat) === 1;
  if (!vatEnabled || !vatRate || !amount) return 0;
  const divisor = (100 + vatRate) / 100;
  const dsaFees = Number(event.dsa_fees) || 0;
  const vatFee = amount >= dsaFees ? amount - dsaFees : amount;
  return Math.round((vatFee - vatFee / divisor) * 100) / 100;
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

async function chkUserByEmail(pool, email) {
  const [rows] = await pool.query(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [trim(email)]
  );
  return rows?.[0]?.id || 0;
}

async function insertNewUser(pool, attendee) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const [result] = await pool.query(
    `INSERT INTO users
      (first_name, sur_name, email, contact1, contact2, contact3, reg_type, status, created, modified)
     VALUES (?, ?, ?, ?, ?, ?, 'g', 1, ?, ?)`,
    [
      titleCase(attendee.first_name),
      titleCase(attendee.sur_name),
      trim(attendee.email),
      trim(attendee.contact1).replace(/\s/g, ''),
      trim(attendee.contact2).replace(/\s/g, ''),
      trim(attendee.contact3).replace(/\s/g, ''),
      now,
      now,
    ]
  );
  return result.insertId;
}

async function upsertContactCard(pool, attendee, bookingId, bookingRef) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const license = trim(attendee.license_number).toUpperCase();
  const cardId = Number(attendee.self_attendee) || 0;

  if (cardId > 0) {
    await pool.query(
      `UPDATE booking_attendees_dropdown
       SET booking_id = ?, booking_ref = ?, first_name = ?, sur_name = ?,
           contact1 = ?, contact2 = ?, contact3 = ?, email = ?,
           vehicle_type = ?, license_type = ?, license_number = ?, theory_number = ?
       WHERE id = ?`,
      [
        bookingId,
        bookingRef,
        titleCase(attendee.first_name),
        titleCase(attendee.sur_name),
        trim(attendee.contact1).replace(/\s/g, ''),
        trim(attendee.contact2).replace(/\s/g, ''),
        trim(attendee.contact3).replace(/\s/g, ''),
        trim(attendee.email),
        attendee.vehicle_type,
        attendee.license_type,
        license,
        trim(attendee.theory_number),
        cardId,
      ]
    );
    return cardId;
  }

  if (license) {
    const [existing] = await pool.query(
      'SELECT id FROM booking_attendees_dropdown WHERE license_number = ? LIMIT 1',
      [license]
    );
    if (existing?.[0]?.id) {
      await pool.query(
        `UPDATE booking_attendees_dropdown
         SET booking_id = ?, booking_ref = ?, first_name = ?, sur_name = ?,
             contact1 = ?, contact2 = ?, contact3 = ?, date_of_birth = ?, email = ?,
             vehicle_type = ?, license_type = ?, license_number = ?, theory_number = ?
         WHERE id = ?`,
        [
          bookingId,
          bookingRef,
          titleCase(attendee.first_name),
          titleCase(attendee.sur_name),
          trim(attendee.contact1).replace(/\s/g, ''),
          trim(attendee.contact2).replace(/\s/g, ''),
          trim(attendee.contact3).replace(/\s/g, ''),
          parseDateOfBirth(attendee.date_of_birth),
          trim(attendee.email),
          attendee.vehicle_type,
          attendee.license_type,
          license,
          trim(attendee.theory_number),
          existing[0].id,
        ]
      );
      return existing[0].id;
    }
  }

  const [insertResult] = await pool.query(
    `INSERT INTO booking_attendees_dropdown
      (booking_ref, booking_id, first_name, sur_name, contact1, contact2, contact3,
       date_of_birth, email, vehicle_type, license_type, license_number, theory_number, created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bookingRef,
      bookingId,
      titleCase(attendee.first_name),
      titleCase(attendee.sur_name),
      trim(attendee.contact1).replace(/\s/g, ''),
      trim(attendee.contact2).replace(/\s/g, ''),
      trim(attendee.contact3).replace(/\s/g, ''),
      parseDateOfBirth(attendee.date_of_birth),
      trim(attendee.email),
      attendee.vehicle_type,
      attendee.license_type,
      license,
      trim(attendee.theory_number),
      now,
    ]
  );
  return insertResult.insertId;
}

async function saveAttendee(pool, bookingId, attendee) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const bookingRef = await bookingRefNo(pool, bookingId);
  const contactCardId = await upsertContactCard(
    pool,
    attendee,
    bookingId,
    bookingRef
  );

  await pool.query(
    `INSERT INTO booking_attendees
      (booking_ref, booking_id, first_name, sur_name, contact1, contact2, contact3,
       date_of_birth, email, vehicle_type, license_type, license_number, theory_number,
       admin_notes, notes, \`primary\`, created, previousparent, contact_card_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      bookingRef,
      bookingId,
      titleCase(attendee.first_name),
      titleCase(attendee.sur_name),
      trim(attendee.contact1).replace(/\s/g, ''),
      trim(attendee.contact2).replace(/\s/g, ''),
      trim(attendee.contact3).replace(/\s/g, ''),
      parseDateOfBirth(attendee.date_of_birth),
      trim(attendee.email),
      attendee.vehicle_type,
      attendee.license_type,
      trim(attendee.license_number).toUpperCase(),
      trim(attendee.theory_number),
      trim(attendee.admin_notes),
      trim(attendee.notes),
      now,
      trim(attendee.self_attendee_new),
      contactCardId,
    ]
  );

  if (trim(attendee.email)) {
    let uid = await chkUserByEmail(pool, attendee.email);
    if (!uid) {
      uid = await insertNewUser(pool, attendee);
    }
    await pool.query('UPDATE bookings SET user_id = ? WHERE id = ?', [
      uid,
      bookingId,
    ]);
  }

  return bookingRef;
}

async function saveBookingCompleteCash(pool, bookingId) {
  await pool.query(
    'UPDATE bookings SET payment_due = payment_due - admin_payment_received, status = 1 WHERE id = ?',
    [bookingId]
  );
  const [bookRows] = await pool.query(
    'SELECT admin_payment_received FROM bookings WHERE id = ? LIMIT 1',
    [bookingId]
  );
  const amount = bookRows?.[0]?.admin_payment_received || 0;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(
    `INSERT INTO booking_payments
      (booking_id, payment_type, transation_id, response, amount, created)
     VALUES (?, 'CASH', '', '', ?, ?)`,
    [bookingId, amount, now]
  );

  const { sendAdminBookingConfirmationEmail } = require('./adminBookingEmailService');
  await sendAdminBookingConfirmationEmail(pool, bookingId);
}

async function saveBookingRecord(pool, attendee, event, adminId, moto, lockId, session) {
  const amount = Number(attendee.course_cost) || 0;
  const paymentReceived = Number(attendee.payment_received) || 0;
  const vatRate = getVatRate(session);
  const vat = computeVat(amount, event, vatRate);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const promoData = session?.adminBooking?.BookingPromoData;
  const isPromoApplied =
    promoData?.is_promo_code_valid && Number(promoData.promo_id) > 0 ? 1 : 0;
  const promoCodeId = isPromoApplied ? Number(promoData.promo_id) : 0;
  const promoCodeData = phpSerialize({
    original_amount: session?.adminBooking?.adminOriginalAmount || {},
    promo_code: promoData?.promo_code || '',
    promo_id: promoCodeId,
  });

  const [insertResult] = await pool.query(
    `INSERT INTO bookings
      (course_id, course_event_id, user_id, booking_made_by_id, booking_made_by,
       type_of_book, spaces, payment_due, total_fees, vatrate, vat, total_amount,
       status, lockid, created, modified, admin_payment_received,
       is_promo_applied, promo_code_id, promo_code_data)
     VALUES (?, ?, 0, ?, 'admin', ?, 1, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.course_id,
      event.id,
      adminId,
      moto ? 'm' : 't',
      amount,
      amount,
      vatRate,
      vat,
      amount,
      lockId || 0,
      now,
      now,
      paymentReceived,
      isPromoApplied,
      promoCodeId,
      promoCodeData,
    ]
  );

  const bookingId = insertResult.insertId;
  const bookingRef = await saveAttendee(pool, bookingId, attendee);

  if (!moto) {
    await saveBookingCompleteCash(pool, bookingId);
  }

  return { bookingId, bookingRef };
}

async function updateVehicleLocks(pool, session, manCount, autoCount) {
  const adminBooking = requireActiveBookingSession(session);
  const lockData = adminBooking.lock_session;
  const manOld = Number(lockData.manual_lock || 0);
  const autoOld = Number(lockData.automatic_lock || 0);

  await pool.query(
    'UPDATE lock_bookings SET manual_lock = ?, automatic_lock = ? WHERE id = ?',
    [manCount, autoCount, lockData.id]
  );

  const [eventsData] = await pool.query(
    'SELECT * FROM course_events WHERE parent = ?',
    [lockData.parent]
  );

  for (const edata of eventsData || []) {
    const svM = Number(edata.manual_lock_done || 0) - manOld + manCount;
    const svA = Number(edata.automatic_lock_done || 0) - autoOld + autoCount;
    await pool.query(
      'UPDATE course_events SET manual_lock_done = ?, automatic_lock_done = ? WHERE id = ?',
      [svM, svA, edata.id]
    );
  }

  const [lockRows] = await pool.query(
    'SELECT * FROM lock_bookings WHERE id = ? LIMIT 1',
    [lockData.id]
  );
  adminBooking.lock_session = lockRows?.[0] || lockData;
}

async function removeLockRow(pool, lock, { notBooking = true } = {}) {
  const lockId = Number(lock?.id);
  if (!Number.isFinite(lockId) || lockId <= 0) return false;

  const [deleteResult] = await pool.query(
    'DELETE FROM lock_bookings WHERE id = ?',
    [lockId]
  );
  if (!deleteResult?.affectedRows) {
    return false;
  }

  const spaceRequired = Number(lock.space_required) || 0;
  const eventId = Number(lock.event_id) || 0;
  const parent = lock.parent;

  let eventsData = [];
  if (parent != null && String(parent).trim() !== '') {
    const [rows] = await pool.query(
      'SELECT * FROM course_events WHERE parent = ?',
      [parent]
    );
    eventsData = rows || [];
  }

  if (!eventsData.length && eventId > 0) {
    const [rows] = await pool.query(
      `SELECT * FROM course_events
       WHERE id = ?
          OR parent = (SELECT parent FROM course_events WHERE id = ? LIMIT 1)`,
      [eventId, eventId]
    );
    eventsData = rows || [];
  }

  if (!eventsData.length || spaceRequired <= 0) {
    return true;
  }

  for (const edata of eventsData) {
    if (notBooking) {
      const svM =
        Number(edata.manual_lock_done || 0) - Number(lock.manual_lock || 0);
      const svA =
        Number(edata.automatic_lock_done || 0) -
        Number(lock.automatic_lock || 0);
      await pool.query(
        'UPDATE course_events SET manual_lock_done = ?, automatic_lock_done = ? WHERE id = ?',
        [Math.max(0, svM), Math.max(0, svA), edata.id]
      );
    }
    await pool.query(
      `UPDATE course_events
       SET current_locks = GREATEST(0, current_locks - ?)
       WHERE id = ?`,
      [spaceRequired, edata.id]
    );
  }

  return true;
}

async function removeCurrentLock(pool, session, notBooking = true) {
  const adminBooking = session?.adminBooking;
  const lockData = adminBooking?.lock_session;
  const lockId = Number(lockData?.id);
  if (!Number.isFinite(lockId) || lockId <= 0) return false;

  const [lockRows] = await pool.query(
    'SELECT * FROM lock_bookings WHERE id = ? LIMIT 1',
    [lockId]
  );
  const lock = lockRows?.[0] || lockData;
  if (!lock) return false;

  return removeLockRow(pool, lock, { notBooking });
}

/**
 * Clear every admin/terminal lock for this admin (and any orphan session lock),
 * and roll back course_events.current_locks for each.
 */
async function removeAllTerminalLocksForAdmin(pool, session, adminId) {
  const resolvedAdminId = Number(adminId) || 0;
  const sessionLockId = Number(session?.adminBooking?.lock_session?.id) || 0;
  const seen = new Set();
  let removed = 0;

  const [locks] = await pool.query(
    `SELECT *
     FROM lock_bookings
     WHERE delete_process = 0
       AND locked_by = 'terminal'
       AND (
         (? > 0 AND user_id = ?)
         OR (? > 0 AND id = ?)
       )`,
    [resolvedAdminId, resolvedAdminId, sessionLockId, sessionLockId]
  );

  for (const lock of locks || []) {
    const id = Number(lock.id);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    // eslint-disable-next-line no-await-in-loop
    const ok = await removeLockRow(pool, lock, { notBooking: true });
    if (ok) removed += 1;
  }

  // Fallback: still clear the session lock if it was somehow missed above.
  if (sessionLockId > 0 && !seen.has(sessionLockId)) {
    const ok = await removeCurrentLock(pool, session, true);
    if (ok) removed += 1;
  }

  return { removed };
}

async function addBookingsDone(pool, session, evId, spaceRequired) {
  if (spaceRequired <= 0) return;
  const [parentRows] = await pool.query(
    'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
    [evId]
  );
  const parent = parentRows?.[0]?.parent;
  if (parent == null) return;

  await pool.query(
    'UPDATE course_events SET bookings_done = bookings_done + ? WHERE parent = ?',
    [spaceRequired, parent]
  );

  await removeCurrentLock(pool, session, false);
  if (session) delete session.adminBooking;
}

async function getAddBookingWizard(pool, session) {
  await removeExpirelocks(pool, session);
  const adminBooking = requireActiveBookingSession(session);

  const lockId = Number(adminBooking.lock_session?.id);
  if (lockId) {
    const [lockRows] = await pool.query(
      'SELECT * FROM lock_bookings WHERE id = ? AND delete_process = 0 LIMIT 1',
      [lockId]
    );
    if (!lockRows?.[0]) {
      if (session) delete session.adminBooking;
      const err = new Error(
        'Your session has been timed out and your booking has been cancelled.'
      );
      err.status = 400;
      throw err;
    }
    adminBooking.lock_session = lockRows[0];
  }

  const eventId = Number(adminBooking.eventId);
  const spaceRequired = Number(adminBooking.space_required) || 0;
  const event = await getEventContext(pool, eventId);
  if (!event) {
    const err = new Error('Invalid course, Try again');
    err.status = 404;
    throw err;
  }

  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date ASC`,
    [eventId]
  );
  const dates = buildEventDatesMap(dateRows);
  const showCancellation = showDepositCancellationWarning(event, dates);
  const lockSession = adminBooking.lock_session;
  const manOld = Number(lockSession?.manual_lock || 0);
  const autoOld = Number(lockSession?.automatic_lock || 0);
  const manualAvail =
    Number(event.vehicle_type_manual || 0) -
    Number(event.manual_lock_done || 0) +
    manOld;
  const autoAvail =
    Number(event.vehicle_type_automatic || 0) -
    Number(event.automatic_lock_done || 0) +
    autoOld;

  const dateEntries = Object.entries(dates).map(([dateKey, timeRange], index) => ({
    day_number: index + 1,
    date_key: dateKey,
    date_label: dateKey === 'TBC' ? 'TBC' : formatLongDate(dateKey),
    time_label: formatTimeAmPm(timeRange),
    is_tbc: dateKey === 'TBC',
  }));

  const defaultPricing = getDefaultAttendeePricing(event, showCancellation);
  const vehiclePricing = getVehiclePricingMap(event, showCancellation);
  const savedAttendees = adminBooking.Booking_data || {};
  const blacklisted = session?.blacklisted || null;
  const promoData = adminBooking.BookingPromoData || null;
  const firstEventDate = firstEventDateFromDates(dates);
  const vehicleTypes = Array.from({ length: spaceRequired }, (_, i) => {
    const saved = savedAttendees[String(i + 1)];
    return saved?.vehicle_type != null && saved?.vehicle_type !== ''
      ? String(saved.vehicle_type)
      : '';
  });
  syncAdminOriginalAmount(
    adminBooking,
    event,
    showDepositPrice(event, firstEventDate),
    vehicleTypes,
    savedAttendees
  );

  return {
    event_id: eventId,
    space_required: spaceRequired,
    lock_expires_at: getLockExpiryIso(lockSession, adminBooking.lock_countdown),
    lock_expire_minutes: LOCK_EXPIRE_TIME_MINUTES,
    event: {
      id: event.id,
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
      cancel_days: Number(event.cancel_days ?? event.deposit_days ?? 0) || 0,
      deposit_days: Number(event.deposit_days ?? event.cancel_days ?? 0) || 0,
      cancel_price: Number(event.cancel_price) || 0,
      school_one_off_price: Number(event.school_one_off_price) || 0,
      school_deposit_price: Number(event.school_deposit_price) || 0,
      school_total_price: Number(event.school_total_price) || 0,
      own_one_off_price: Number(event.own_one_off_price) || 0,
      own_deposit_price: Number(event.own_deposit_price) || 0,
      own_total_price: Number(event.own_total_price) || 0,
      date_entries: dateEntries,
      is_multi_day: dateEntries.filter((d) => !d.is_tbc).length > 1,
      first_date_label:
        dateEntries.find((d) => !d.is_tbc)?.date_label || 'TBC',
    },
    manual_avail: Math.max(0, manualAvail),
    auto_avail: Math.max(0, autoAvail),
    show_deposit_cancellation_warning: showCancellation,
    vehicle_type_options: buildVehicleTypeOptions(event, lockSession),
    vehicle_pricing: vehiclePricing,
    default_pricing: defaultPricing,
    licence_types: await getLicenceTypes(pool),
    saved_attendees: savedAttendees,
    blacklisted,
    cancellation_notice: buildCancellationNotice(event),
    promo: promoData?.is_promo_code_valid
      ? {
          applied: true,
          code: promoData.promo_code || '',
          message: promoData.promo_message || '',
          payment_type: promoData.payment_type || 'deposit',
          amounts: promoData.amtArr || {},
        }
      : {
          applied: false,
          code: '',
          message: '',
          payment_type: 'deposit',
          amounts: {},
        },
  };
}

function buildCancellationNotice(event) {
  const cancelDays =
    Number(event.cancel_days ?? event.deposit_days ?? 0) || 0;
  const depositDays =
    Number(event.deposit_days ?? event.cancel_days ?? 0) || 0;
  const cancelPrice = Number(event.cancel_price) || 0;
  const oneOff =
    Number(event.school_one_off_price) > 0 ||
    Number(event.own_one_off_price) > 0;

  if (oneOff) {
    return `Any cancellations or alterations to a booking must be made at least ${cancelDays} clear days before the date of your course, and will be subject to an administration fee of £${cancelPrice} for each space booked. Cancellations or alterations made within ${cancelDays} clear days will result in your payment being forfeited with no refund being issued.`;
  }

  return `Any cancellations or alterations to a booking must be made at least ${depositDays} clear days before the date of your course, at the latest, and will be subject to an administration fee of £${cancelPrice} for each place booked. Any cancellations or alterations made within ${depositDays} clear days of the date of your course will result in any deposit paid for your course being retained by 1 Stop Instruction. In the event of any cancellation or alteration being made within ${cancelDays} clear days of the date of your course, you will also be liable to pay any outstanding balance in relation to your chosen course.`;
}

function normalizeAttendeesPayload(body, spaceRequired) {
  const ba = body?.BA || body?.attendees || {};
  const attendees = [];
  for (let i = 1; i <= spaceRequired; i += 1) {
    const row = ba[String(i)] || ba[i];
    if (row && typeof row === 'object') {
      attendees.push({ index: i, ...row });
    }
  }
  return attendees;
}

function validateAttendee(row) {
  const errors = [];
  if (!trim(row.first_name)) errors.push('First name is required');
  if (!trim(row.sur_name)) errors.push('Surname is required');
  if (!trim(row.email)) errors.push('Email is required');
  if (row.vehicle_type === '' || row.vehicle_type == null) {
    errors.push('Vehicle type is required');
  }
  if (row.license_type === '' || row.license_type == null) {
    errors.push('Licence type is required');
  }
  if (!trim(row.license_number)) errors.push('Licence number is required');
  if (trim(row.license_number).length !== 16) {
    errors.push('Licence number must be 16 characters');
  }
  return errors;
}

async function submitAddBookingAttendees(pool, session, body, adminId) {
  await removeExpirelocks(pool, session);
  const adminBooking = requireActiveBookingSession(session);
  const eventId = Number(adminBooking.eventId);
  const spaceRequired = Number(adminBooking.space_required) || 0;
  const eventRow = await getEventContext(pool, eventId);
  if (!eventRow) {
    const err = new Error('Invalid course, Try again');
    err.status = 404;
    throw err;
  }

  const event = { ...eventRow, id: eventId };
  const [dateRows] = await pool.query(
    'SELECT event_date FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date ASC LIMIT 1',
    [eventId]
  );
  const dates = buildEventDatesMap(dateRows);
  const showCancellation = showDepositCancellationWarning(event, dates);

  const attendees = normalizeAttendeesPayload(body, spaceRequired);
  if (attendees.length !== spaceRequired) {
    const err = new Error('Please complete details for all attendees');
    err.status = 400;
    throw err;
  }

  if (session) delete session.blacklisted;

  for (const attendee of attendees) {
    const fieldErrors = validateAttendee(attendee);
    if (fieldErrors.length) {
      const err = new Error(fieldErrors.join('; '));
      err.status = 400;
      throw err;
    }
  }

  const seenLicences = new Map();
  for (const attendee of attendees) {
    const licence = trim(attendee.license_number).toUpperCase();
    if (!licence) continue;
    if (seenLicences.has(licence)) {
      const err = new Error(
        `Driving licence number is already used by Student ${seenLicences.get(
          licence
        )}. Each student must have a unique licence number.`
      );
      err.status = 400;
      throw err;
    }
    seenLicences.set(licence, attendee.index);
  }

  for (const attendee of attendees) {
    const blackData = await checkBlacklisted(pool, attendee.license_number);
    if (blackData) {
      if (session) {
        session.blacklisted = {
          status: 1,
          data: { [attendee.index]: blackData },
        };
      }
      adminBooking.Booking_data = body.BA || body.attendees;
      const err = new Error(
        'There has been a problem with your booking. Please contact our office for more information'
      );
      err.status = 400;
      err.code = 'BLACKLISTED';
      throw err;
    }
  }

  let manCount = 0;
  let autoCount = 0;
  for (const attendee of attendees) {
    if (Number(attendee.vehicle_type) === 1) autoCount += 1;
    else if (Number(attendee.vehicle_type) === 0) manCount += 1;
  }

  const wizard = await getAddBookingWizard(pool, session);
  if (manCount > 0 && wizard.manual_avail < manCount) {
    const err = new Error('Your selected vehicles not available');
    err.status = 400;
    throw err;
  }
  if (autoCount > 0 && wizard.auto_avail < autoCount) {
    const err = new Error('Your selected vehicles not available');
    err.status = 400;
    throw err;
  }

  if (manCount > 0 || autoCount > 0) {
    await updateVehicleLocks(pool, session, manCount, autoCount);
  }

  const moto =
    body?.world_payment === true ||
    body?.world_payment === 'yes' ||
    body?.BA?.world_payment === 'yes' ||
    body?.BA?.world_payment === true;
  const lockId = Number(adminBooking.lock_session?.id) || 0;
  const bookingRefs = [];
  const bookingIds = [];

  for (const attendee of attendees) {
    const pricing = getPricingForVehicle(
      event,
      showCancellation,
      attendee.vehicle_type
    );
    const payload = {
      ...attendee,
      course_cost: Number(attendee.course_cost ?? pricing.course_cost) || 0,
      payment_received:
        Number(attendee.payment_received ?? pricing.payment_received) || 0,
      amount_outstanding:
        Number(attendee.amount_outstanding ?? pricing.amount_outstanding) || 0,
    };

    const saved = await saveBookingRecord(
      pool,
      payload,
      event,
      adminId,
      moto,
      lockId,
      session
    );
    bookingRefs.push(saved.bookingRef);
    bookingIds.push(saved.bookingId);
  }

  adminBooking.Booking_data = { ...(body.BA || body.attendees || {}) };
  for (let i = 0; i < bookingIds.length; i += 1) {
    const key = String(i + 1);
    if (
      adminBooking.Booking_data[key] &&
      typeof adminBooking.Booking_data[key] === 'object'
    ) {
      adminBooking.Booking_data[key] = {
        ...adminBooking.Booking_data[key],
        booking_ref: bookingRefs[i],
      };
    }
  }

  if (moto) {
    session.worldPaymentBookings = bookingIds;
    session.motoPaymentBookings = [];
    return {
      payment_mode: 'worldpay',
      booking_ids: bookingIds,
      booking_refs: bookingRefs,
      next_url: `/admin/bookings/worldpay`,
    };
  }

  await addBookingsDone(pool, session, eventId, spaceRequired);
  if (session) {
    delete session.preFillData;
    delete session.courseEvent;
  }

  return {
    payment_mode: 'cash',
    booking_ids: bookingIds,
    booking_refs: bookingRefs,
    next_url: `/admin/bookings/confirmation?evId=${eventId}`,
  };
}

async function cancelAddBookingWizard(
  pool,
  session,
  saveClientDetails = false,
  adminId = 0
) {
  if (saveClientDetails && session?.adminBooking?.Booking_data) {
    session.preFillData = session.adminBooking.Booking_data;
  }

  const resolvedAdminId =
    Number(adminId) ||
    Number(session?.loggedinAdmin?.admin_id) ||
    Number(session?.loggedinAdmin?.id) ||
    Number(session?.admin) ||
    Number(session?.adminBooking?.lock_session?.user_id) ||
    0;

  const result = await removeAllTerminalLocksForAdmin(
    pool,
    session,
    resolvedAdminId
  );

  if (session) delete session.adminBooking;
  return { cancelled: true, removed: result.removed };
}

module.exports = {
  getAddBookingWizard,
  getContactCard,
  searchExistingCustomers,
  submitAddBookingAttendees,
  cancelAddBookingWizard,
  removeAllTerminalLocksForAdmin,
  checkAdminBookingPromoCode,
  cancelAdminBookingPromoCode,
};
