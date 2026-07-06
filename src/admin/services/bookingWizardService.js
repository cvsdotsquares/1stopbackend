const { removeExpirelocks } = require('./bookingService');
const {
  getEvent,
  getLockBooking,
  lockBooking,
  removeCurLock,
  showDepositPrice,
  timeAmPm,
  buildLockTimer,
  getCourseEventRow,
} = require('./bookingDetailsService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function formatTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function formatDateValue(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  return str;
}

function parseDobInput(value) {
  const raw = trim(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return raw;
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function ucWordsName(value) {
  return trim(value)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function bookingRefNo(prefix, number) {
  if (!prefix) {
    return `1SRC${number}`;
  }
  return `${prefix}${number}`;
}

function calculateDisAmt(discountType, discountAmount, amount) {
  const base = Number(amount) || 0;
  if (base <= 0) {
    return 0;
  }
  let result = base;
  if (discountType === 'pounds_off') {
    result = base - Number(discountAmount);
  } else if (discountType === 'percent_off') {
    const disAmt = (base * Number(discountAmount)) / 100;
    result = base - disAmt;
  }
  return result < 0 ? 0 : result;
}

function calculateCourseAmount(ce, attendees) {
  let fees = 0;
  const attFee = {};
  for (const [key, att] of Object.entries(attendees || {})) {
    if (att === '' || att == null) {
      continue;
    }
    const vehicleType = Number(att);
    if (!Number.isNaN(vehicleType) && (ce.school_one_off_price || ce.own_one_off_price)) {
      if (vehicleType === 3) {
        const atfee = Number(ce.own_one_off_price) || 0;
        fees += atfee;
        attFee[key] = { total: atfee, deposit: atfee };
      } else {
        const atfee = Number(ce.school_one_off_price) || 0;
        fees += atfee;
        attFee[key] = { total: atfee, deposit: atfee };
      }
    } else if (!Number.isNaN(vehicleType)) {
      if (vehicleType === 3) {
        fees += Number(ce.own_deposit_price) || 0;
        attFee[key] = {
          total: Number(ce.own_total_price) || Number(ce.own_deposit_price) || 0,
          deposit: Number(ce.own_deposit_price) || 0,
        };
      } else {
        fees += Number(ce.school_deposit_price) || 0;
        attFee[key] = {
          total: Number(ce.school_total_price) || Number(ce.school_deposit_price) || 0,
          deposit: Number(ce.school_deposit_price) || 0,
        };
      }
    }
  }
  return { fee: fees, attFee };
}

function buildAttendeeDefaults(ce, showDepositWarning, index) {
  const ownOnly =
    Number(ce.vehicle_type_own) > 0 &&
    Number(ce.vehicle_type_manual) === 0 &&
    Number(ce.vehicle_type_automatic) === 0;

  if (Number(ce.school_one_off_price) > 0) {
    return {
      course_cost: Number(ce.school_one_off_price),
      payment_received: Number(ce.school_one_off_price),
      amount_outstanding: 0,
    };
  }

  let courseCost = Number(ce.school_total_price) || 0;
  let paymentReceived = Number(ce.school_deposit_price) || 0;
  let amountOutstanding = courseCost - paymentReceived;

  if (ownOnly && showDepositWarning) {
    courseCost = Number(ce.own_one_off_price) || Number(ce.own_total_price) || courseCost;
    paymentReceived = courseCost;
    amountOutstanding = 0;
  } else if (showDepositWarning) {
    paymentReceived = courseCost;
    amountOutstanding = 0;
  }

  return {
    course_cost: courseCost,
    payment_received: paymentReceived,
    amount_outstanding: amountOutstanding,
    index,
  };
}

function ensureAdminBookingSession(req) {
  if (!req.session.adminBooking) {
    req.session.adminBooking = {};
  }
  return req.session.adminBooking;
}

function getAdminIdFromSession(req) {
  const admin = req.session?.loggedinAdmin;
  return Number(admin?.admin_id ?? admin?.id) || 0;
}

function requireAdminBookingSession(req) {
  const adminBooking = req.session?.adminBooking;
  if (!adminBooking?.eventId || !adminBooking?.space_required || !adminBooking?.lock_session?.id) {
    return null;
  }
  return adminBooking;
}

/** Rehydrate lock_session from DB when session still has event/spaces but lock row was lost. */
async function refreshAdminBookingLock(pool, req) {
  const adminBooking = ensureAdminBookingSession(req);
  const evId = Number(adminBooking.eventId);
  const spaceRequired = Number(adminBooking.space_required);

  if (!Number.isFinite(evId) || evId <= 0 || !Number.isFinite(spaceRequired) || spaceRequired <= 0) {
    return null;
  }

  const lockId = Number(adminBooking.lock_session?.id);
  if (lockId) {
    const lock = await getLockBooking(pool, lockId);
    if (lock) {
      adminBooking.lock_session = lock;
      if (!adminBooking.lock_countdown) {
        adminBooking.lock_countdown = Math.floor(Date.now() / 1000);
      }
      return adminBooking;
    }
  }

  const adminId = getAdminIdFromSession(req);
  if (!adminId) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT * FROM lock_bookings
     WHERE event_id = ? AND user_id = ? AND locked_by = 'terminal'
     ORDER BY id DESC LIMIT 1`,
    [evId, adminId]
  );
  const lock = rows[0];
  if (!lock?.id) {
    return null;
  }

  adminBooking.lock_session = lock;
  if (!adminBooking.lock_countdown) {
    adminBooking.lock_countdown = Math.floor(Date.now() / 1000);
  }
  return adminBooking;
}

async function resolveAdminBookingSession(pool, req) {
  await removeExpirelocks(pool, req.session);
  const refreshed = await refreshAdminBookingLock(pool, req);
  return refreshed || requireAdminBookingSession(req);
}

async function getVatRate(pool) {
  try {
    const [rows] = await pool.query(
      'SELECT vat_rate FROM settings ORDER BY id DESC LIMIT 1'
    );
    return Number(rows[0]?.vat_rate) || 0;
  } catch {
    return 0;
  }
}

async function getLicenceTypes(pool) {
  const [rows] = await pool.query(
    'SELECT id, licence_type FROM driving_licence_types ORDER BY id ASC'
  );
  return rows || [];
}

function formatCustomerLabel(row) {
  const parts = [
    trim(row.first_name),
    trim(row.sur_name),
    trim(row.contact1),
    trim(row.email),
    trim(row.license_number),
  ].filter(Boolean);
  return parts.join(', ');
}

function mapCustomerRow(row) {
  return {
    uid: Number(row.uid ?? row.id),
    sid: row.sid || row.booking_ref || '',
    first_name: row.first_name || '',
    sur_name: row.sur_name || '',
    contact1: row.contact1 || '',
    contact2: row.contact2 || '',
    contact3: row.contact3 || '',
    license_number: row.license_number || '',
    email: row.email || '',
    date_of_birth: row.date_of_birth || '',
    vehicle_type:
      row.vehicle_type != null && row.vehicle_type !== ''
        ? String(row.vehicle_type)
        : '',
    license_type:
      row.license_type != null && row.license_type !== ''
        ? String(row.license_type)
        : '',
    theory_number: row.theory_number || '',
    bid: row.bid ?? row.booking_id ?? null,
    label: formatCustomerLabel(row),
  };
}

/** Search existing customers — legacy getUsersAddBookingSelectNew (too large to embed in wizard GET). */
async function searchExistingCustomers(pool, search = '', limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const term = trim(search);
  let rows;

  if (term) {
    const like = `%${term}%`;
    [rows] = await pool.query(
      `SELECT booking_attendees.id AS uid, booking_attendees.booking_ref AS sid,
        booking_attendees.first_name, booking_attendees.sur_name,
        booking_attendees.contact1, booking_attendees.contact2, booking_attendees.contact3,
        booking_attendees.license_number, booking_attendees.email,
        booking_attendees.date_of_birth, booking_attendees.vehicle_type,
        booking_attendees.license_type, booking_attendees.theory_number,
        bookings.id AS bid
       FROM booking_attendees_dropdown AS booking_attendees
       LEFT JOIN bookings ON booking_attendees.booking_id = bookings.id
       WHERE booking_attendees.id > 0
         AND (
           booking_attendees.first_name LIKE ?
           OR booking_attendees.sur_name LIKE ?
           OR booking_attendees.contact1 LIKE ?
           OR booking_attendees.email LIKE ?
           OR booking_attendees.license_number LIKE ?
         )
       ORDER BY booking_attendees.first_name ASC, booking_attendees.sur_name ASC
       LIMIT ?`,
      [like, like, like, like, like, safeLimit]
    );
  } else {
    [rows] = await pool.query(
      `SELECT booking_attendees.id AS uid, booking_attendees.booking_ref AS sid,
        booking_attendees.first_name, booking_attendees.sur_name,
        booking_attendees.contact1, booking_attendees.contact2, booking_attendees.contact3,
        booking_attendees.license_number, booking_attendees.email,
        booking_attendees.date_of_birth, booking_attendees.vehicle_type,
        booking_attendees.license_type, booking_attendees.theory_number,
        bookings.id AS bid
       FROM booking_attendees_dropdown AS booking_attendees
       LEFT JOIN bookings ON booking_attendees.booking_id = bookings.id
       WHERE booking_attendees.id > 0
       ORDER BY booking_attendees.first_name ASC, booking_attendees.sur_name ASC
       LIMIT ?`,
      [safeLimit]
    );
  }

  const seen = new Set();
  const customers = [];
  for (const row of rows || []) {
    const mapped = mapCustomerRow(row);
    if (seen.has(mapped.uid)) {
      continue;
    }
    seen.add(mapped.uid);
    customers.push(mapped);
  }
  return customers;
}

async function getExistingCustomerById(pool, userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  const [dropdownRows] = await pool.query(
    'SELECT * FROM booking_attendees_dropdown WHERE id = ? LIMIT 1',
    [id]
  );
  if (dropdownRows[0]) {
    return mapCustomerRow(dropdownRows[0]);
  }

  const [userRows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  if (userRows[0]) {
    return mapCustomerRow({
      uid: userRows[0].id,
      sid: '',
      first_name: userRows[0].first_name,
      sur_name: userRows[0].sur_name,
      contact1: userRows[0].contact1,
      contact2: userRows[0].contact2,
      contact3: userRows[0].contact3,
      email: userRows[0].email,
      license_number: '',
      theory_number: '',
      vehicle_type: '',
      license_type: '',
      date_of_birth: '',
    });
  }

  return null;
}

async function getEventsAddBooking(pool, courseId, evId, spaceRequired) {
  const params = [courseId, spaceRequired];
  const [rows] = await pool.query(
    `SELECT * FROM (
      SELECT locations.location_name, locations.id AS location_id,
        course_event_dates.course_event_id, course_event_dates.event_date,
        course_event_dates.event_start_time, course_event_dates.event_end_time,
        course_events.event_type, course_events.booking_limit,
        course_events.bookings_done, course_events.current_locks,
        courses.course_name, courses.id AS course_id,
        course_events.vehicle_type_manual, course_events.vehicle_type_automatic
      FROM course_event_dates
      JOIN course_events ON course_events.id = course_event_dates.course_event_id
      JOIN courses ON courses.id = course_events.course_id
      JOIN locations ON locations.id = course_events.location_id
      WHERE course_events.status = '1'
        AND courses.status IN ('1', '2')
        AND course_event_dates.event_date != '0000-00-00'
        AND courses.id = ?
        AND ((course_events.booking_limit - (course_events.bookings_done + course_events.current_locks)) >= ?)
      ORDER BY course_event_dates.course_event_id, course_event_dates.event_date ASC,
        locations.location_name ASC, course_event_dates.event_start_time ASC
    ) sq
    GROUP BY sq.course_event_id
    ORDER BY sq.event_date ASC, sq.location_name ASC, sq.event_start_time ASC`,
    params
  );

  const today = formatDateValue(new Date());
  const moveToevents = [];
  const sortArr = [];

  for (const evt of rows || []) {
    const eventDate = formatDateValue(evt.event_date);
    if (
      Number(evt.booking_limit) > Number(evt.bookings_done) + Number(evt.current_locks) &&
      eventDate >= today &&
      Number(evt.course_event_id) !== Number(evId)
    ) {
      const [vehicleRows] = await pool.query(
        `SELECT booking_attendees.vehicle_type
         FROM bookings
         JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
         WHERE bookings.course_event_id = ? AND bookings.status = 1`,
        [evt.course_event_id]
      );
      let manualConsume = 0;
      let autoConsume = 0;
      for (const row of vehicleRows || []) {
        if (Number(row.vehicle_type) < 1) {
          manualConsume += 1;
        }
        if (Number(row.vehicle_type) === 1) {
          autoConsume += 1;
        }
      }
      const start = String(evt.event_start_time || '').slice(0, 5);
      const end = String(evt.event_end_time || '').slice(0, 5);
      moveToevents.push({
        event_date: eventDate,
        course_event_id: Number(evt.course_event_id),
        location_name: evt.location_name,
        'm-avail': Number(evt.vehicle_type_manual) || 0,
        'a-avail': Number(evt.vehicle_type_automatic) || 0,
        'm-booked': manualConsume,
        'a-booked': autoConsume,
        timings: `${start} - ${end}`,
      });
      sortArr.push(Date.parse(`${eventDate}T12:00:00`));
    }
  }

  return { events: moveToevents, order: sortArr.map((_, index) => index) };
}

async function checkBlacklisted(pool, licenseNumber) {
  const licence = trim(licenseNumber);
  if (!licence) {
    return null;
  }
  const [rows] = await pool.query(
    `SELECT * FROM booking_attendees_dropdown
     WHERE id != '' AND is_blacklisted = 1 AND license_number = ?
     LIMIT 1`,
    [licence]
  );
  return rows[0] || null;
}

async function chkUserByEmail(pool, email) {
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [
    trim(email),
  ]);
  return rows[0]?.id || 0;
}

async function insertNewUser(pool, att) {
  const now = formatTimestamp();
  const [result] = await pool.query(
    `INSERT INTO users (first_name, sur_name, email, contact1, contact2, contact3, reg_type, status, created, modified)
     VALUES (?, ?, ?, ?, ?, ?, 'g', 1, ?, ?)`,
    [
      att.first_name,
      att.sur_name,
      att.email,
      att.contact1,
      att.contact2,
      att.contact3,
      now,
      now,
    ]
  );
  return result.insertId;
}

async function saveAttendee(pool, att) {
  const [prefixRows] = await pool.query(
    `SELECT franchise.inv_prefix
     FROM bookings
     LEFT JOIN course_events ON course_events.id = bookings.course_event_id
     LEFT JOIN franchise ON franchise.id = course_events.franchise_id
     WHERE bookings.id = ?
     LIMIT 1`,
    [att.booking_id]
  );
  const bookingRef = bookingRefNo(prefixRows[0]?.inv_prefix, att.booking_id);
  const dateOfBirth = parseDobInput(att.date_of_birth);
  const now = formatTimestamp();

  let contactCardId = 0;
  if (trim(att.license_number)) {
    const [existing] = await pool.query(
      `SELECT id, contact1, contact2, contact3, email, date_of_birth
       FROM booking_attendees_dropdown WHERE license_number = ? LIMIT 1`,
      [String(att.license_number).toUpperCase()]
    );
    if (!existing[0]) {
      const [insertResult] = await pool.query(
        `INSERT INTO booking_attendees_dropdown (
          booking_ref, booking_id, first_name, sur_name, contact1, contact2, contact3,
          date_of_birth, email, vehicle_type, license_type, license_number, theory_number, created
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookingRef,
          att.booking_id,
          ucWordsName(att.first_name),
          ucWordsName(att.sur_name),
          trim(att.contact1).replace(/\s/g, ''),
          trim(att.contact2).replace(/\s/g, ''),
          trim(att.contact3).replace(/\s/g, ''),
          dateOfBirth,
          att.email,
          att.vehicle_type,
          att.license_type,
          String(att.license_number).toUpperCase(),
          att.theory_number,
          now,
        ]
      );
      contactCardId = insertResult.insertId;
    } else {
      contactCardId = existing[0].id;
      await pool.query(
        `UPDATE booking_attendees_dropdown
         SET booking_id = ?, booking_ref = ?, first_name = ?, sur_name = ?,
             contact1 = ?, contact2 = ?, contact3 = ?, date_of_birth = ?, email = ?,
             vehicle_type = ?, license_type = ?, license_number = ?, theory_number = ?
         WHERE id = ?`,
        [
          att.booking_id,
          bookingRef,
          ucWordsName(att.first_name),
          ucWordsName(att.sur_name),
          trim(att.contact1).replace(/\s/g, '') || existing[0].contact1,
          trim(att.contact2).replace(/\s/g, '') || existing[0].contact2,
          trim(att.contact3).replace(/\s/g, '') || existing[0].contact3,
          dateOfBirth || existing[0].date_of_birth,
          att.email || existing[0].email,
          att.vehicle_type,
          att.license_type,
          String(att.license_number).toUpperCase(),
          att.theory_number,
          contactCardId,
        ]
      );
    }
  } else {
    const [insertResult] = await pool.query(
      `INSERT INTO booking_attendees_dropdown (
        booking_ref, booking_id, first_name, sur_name, contact1, contact2, contact3,
        date_of_birth, email, vehicle_type, license_type, license_number, theory_number, created
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingRef,
        att.booking_id,
        ucWordsName(att.first_name),
        ucWordsName(att.sur_name),
        trim(att.contact1).replace(/\s/g, ''),
        trim(att.contact2).replace(/\s/g, ''),
        trim(att.contact3).replace(/\s/g, ''),
        dateOfBirth,
        att.email,
        att.vehicle_type,
        att.license_type,
        String(att.license_number || '').toUpperCase(),
        att.theory_number,
        now,
      ]
    );
    contactCardId = insertResult.insertId;
  }

  if (!trim(att.self_attendee)) {
    let uid = await chkUserByEmail(pool, att.email);
    if (!uid && trim(att.email)) {
      uid = await insertNewUser(pool, att);
    }
    if (uid) {
      await pool.query('UPDATE bookings SET user_id = ? WHERE id = ?', [uid, att.booking_id]);
    }
  }

  await pool.query(
    `INSERT INTO booking_attendees (
      booking_ref, booking_id, first_name, sur_name, contact1, contact2, contact3,
      date_of_birth, email, vehicle_type, license_type, license_number, theory_number,
      admin_notes, notes, \`primary\`, created, previousparent, contact_card_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      bookingRef,
      att.booking_id,
      ucWordsName(att.first_name),
      ucWordsName(att.sur_name),
      trim(att.contact1).replace(/\s/g, ''),
      trim(att.contact2).replace(/\s/g, ''),
      trim(att.contact3).replace(/\s/g, ''),
      dateOfBirth,
      att.email,
      att.vehicle_type,
      att.license_type,
      String(att.license_number || '').toUpperCase(),
      att.theory_number,
      att.admin_notes || '',
      att.notes || '',
      now,
      att.self_attendee_new || '',
      contactCardId,
    ]
  );

  return bookingRef;
}

async function saveBookingCompleteWorld(pool, bookId, payment) {
  const [bookRows] = await pool.query('SELECT * FROM bookings WHERE id = ? LIMIT 1', [
    bookId,
  ]);
  const bookData = bookRows[0];
  if (!bookData) {
    return false;
  }
  await pool.query(
    'UPDATE bookings SET payment_due = payment_due - admin_payment_received, status = 1 WHERE id = ?',
    [bookId]
  );
  await pool.query(
    `INSERT INTO booking_payments (booking_id, payment_type, transation_id, response, amount, created)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      bookId,
      payment.type,
      payment.transation_id,
      payment.response,
      bookData.admin_payment_received,
      formatTimestamp(),
    ]
  );
  return true;
}

async function saveBookingWorld(pool, req, bd, moto, ce, adminId) {
  const amount = Number(bd.course_cost) || 0;
  const vatrate = await getVatRate(pool);
  let vat = 0;
  if (Number(ce.vat) === 1 && vatrate > 0 && amount > 0) {
    const rate = (100 + vatrate) / 100;
    const vatFee = amount >= Number(ce.dsa_fees) ? amount - Number(ce.dsa_fees) : amount;
    vat = Math.round((vatFee - vatFee / rate) * 100) / 100;
  }

  let promoCodeId = 0;
  let isPromoApplied = 0;
  const promoData = req.session?.adminBooking?.BookingPromoData;
  if (promoData?.status === 1 && promoData?.is_promo_code_valid === 1) {
    promoCodeId = Number(promoData.promo_id) || 0;
    isPromoApplied = 1;
  }

  const lockId =
    moto === 'yes' ? Number(req.session.adminBooking?.lock_session?.id) || 0 : 0;
  const now = formatTimestamp();

  const [result] = await pool.query(
    `INSERT INTO bookings (
      course_id, course_event_id, user_id, booking_made_by_id, booking_made_by,
      type_of_book, spaces, payment_due, total_fees, vatrate, vat, total_amount,
      status, lockid, created, modified, admin_payment_received,
      is_promo_applied, promo_code_id, promo_code_data
    ) VALUES (?, ?, 0, ?, 'admin', ?, 1, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    [
      bd.course_id,
      bd.course_event_id,
      adminId,
      moto === 'yes' ? 'm' : 't',
      amount,
      amount,
      vatrate,
      vat,
      amount,
      lockId,
      now,
      now,
      Number(bd.payment_received) || 0,
      isPromoApplied,
      promoCodeId,
      JSON.stringify({ original_amount: [] }),
    ]
  );

  const lastBookId = result.insertId;
  const saveAttendeePayload = {
    ...bd.attendee,
    booking_id: lastBookId,
    primary: 1,
  };
  const bookingRef = await saveAttendee(pool, saveAttendeePayload);

  if (moto !== 'yes') {
    await saveBookingCompleteWorld(pool, lastBookId, {
      type: 'CASH',
      transation_id: '',
      response: '',
    });
  }

  if (!req.session.worldPaymentBookings) {
    req.session.worldPaymentBookings = [];
  }
  req.session.worldPaymentBookings.push(lastBookId);

  return bookingRef;
}

async function addBookingsDone(pool, req, evId, spaceRequired) {
  if (Number(spaceRequired) > 0) {
    const [parentRows] = await pool.query(
      'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
      [Number(evId)]
    );
    const parent = parentRows[0]?.parent ?? Number(evId);
    await pool.query(
      'UPDATE course_events SET bookings_done = bookings_done + ? WHERE parent = ?',
      [Number(spaceRequired), parent]
    );
    await removeCurLock(pool, req.session, null, false);
  }
  if (req.session.preFillData) {
    delete req.session.preFillData;
  }
  if (req.session.courseEvent) {
    delete req.session.courseEvent;
  }
  delete req.session.adminBooking;
}

async function updateVehicleLocks(pool, req, ce, submitted) {
  const lockData = req.session.adminBooking?.lock_session;
  if (!lockData?.id) {
    return {
      ok: false,
      code: 'SESSION_EXPIRED',
      message: 'Your booking session has expired. Please lock spaces again.',
      redirect: `/admin/bookings/events/${req.session?.adminBooking?.eventId || ''}`,
    };
  }
  const manCountOld = Number(lockData.manual_lock) || 0;
  const autoCountOld = Number(lockData.automatic_lock) || 0;

  let manCount = 0;
  let autoCount = 0;
  for (const att of Object.values(submitted)) {
    if (!att || typeof att !== 'object') {
      continue;
    }
    if (String(att.vehicle_type) === '1') {
      autoCount += 1;
    } else if (String(att.vehicle_type) === '0') {
      manCount += 1;
    }
  }

  const manualAvail =
    Number(ce.vehicle_type_manual) - Number(ce.manual_lock_done) + manCountOld;
  const autoAvail =
    Number(ce.vehicle_type_automatic) - Number(ce.automatic_lock_done) + autoCountOld;

  if (
    Number(ce.vehicle_type_automatic) > 0 ||
    Number(ce.vehicle_type_manual) > 0
  ) {
    if (manCount > 0 || autoCount > 0) {
      if (
        (manCount > 0 && manualAvail < manCount) ||
        (autoCount > 0 && autoAvail < autoCount)
      ) {
        return { ok: false, message: 'Your selected vehicles not available' };
      }
      await pool.query(
        'UPDATE lock_bookings SET manual_lock = ?, automatic_lock = ? WHERE id = ?',
        [manCount, autoCount, lockData.id]
      );
    } else if (manCountOld > 0 || autoCountOld > 0) {
      await pool.query(
        'UPDATE lock_bookings SET manual_lock = ?, automatic_lock = ? WHERE id = ?',
        [manCountOld, autoCountOld, lockData.id]
      );
    }

    const updatedLock = await getLockBooking(pool, lockData.id);
    req.session.adminBooking.lock_session = updatedLock;

    const [eventsData] = await pool.query(
      'SELECT * FROM course_events WHERE parent = ?',
      [lockData.parent]
    );
    for (const edata of eventsData) {
      const svM = Number(edata.manual_lock_done) - manCountOld + manCount;
      const svA = Number(edata.automatic_lock_done) - autoCountOld + autoCount;
      await pool.query(
        'UPDATE course_events SET manual_lock_done = ?, automatic_lock_done = ? WHERE id = ?',
        [svM, svA, edata.id]
      );
    }
  }

  return { ok: true };
}

async function loadWizard(pool, req) {
  const adminBooking = await resolveAdminBookingSession(pool, req);
  if (!adminBooking) {
    return {
      ok: false,
      code: 'SESSION_EXPIRED',
      message: 'Your booking session has expired. Please lock spaces again.',
      redirect: '/admin/dashboard',
    };
  }

  const evId = Number(adminBooking.eventId);
  const event = await getEvent(pool, evId, req.session);
  if (!event) {
    return { ok: false, message: 'Invalid course, Try again', redirect: '/admin/dashboard' };
  }

  const lockData = adminBooking.lock_session || {};
  const manCountOld = Number(lockData.manual_lock) || 0;
  const autoCountOld = Number(lockData.automatic_lock) || 0;
  const manualAvail =
    Number(event.vehicle_type_manual) - Number(event.manual_lock_done) + manCountOld;
  const autoAvail =
    Number(event.vehicle_type_automatic) - Number(event.automatic_lock_done) + autoCountOld;
  const showDepositWarning = showDepositPrice(event);
  const moveToevents = await getEventsAddBooking(
    pool,
    event.course_id,
    evId,
    Number(adminBooking.space_required)
  );

  const attendeeDefaults = {};
  const adminOriginalAmount = {};
  for (let i = 1; i <= Number(adminBooking.space_required); i += 1) {
    const defaults = buildAttendeeDefaults(event, showDepositWarning, i);
    attendeeDefaults[i] = defaults;
    adminOriginalAmount[i] = {
      course_cost: defaults.course_cost,
      received: defaults.payment_received,
      outstanding: defaults.amount_outstanding,
    };
  }
  req.session.adminOriginalAmount = adminOriginalAmount;

  const savedBookingData = adminBooking.Booking_data || {};
  const preFillData = req.session.preFillData || {};

  return {
    ok: true,
    data: {
      event: {
        id: Number(event.id),
        course_id: Number(event.course_id),
        course_name: event.course_name,
        description: event.description || '',
        dates: event.dates,
        location_name: event.location_name,
        address1: event.address1,
        address2: event.address2,
        address3: event.address3,
        address4: event.address4,
        postcode: event.postcode,
        franchise_name: event.franchise_name,
        school_one_off_price: Number(event.school_one_off_price) || 0,
        school_deposit_price: Number(event.school_deposit_price) || 0,
        school_total_price: Number(event.school_total_price) || 0,
        own_one_off_price: Number(event.own_one_off_price) || 0,
        own_deposit_price: Number(event.own_deposit_price) || 0,
        own_total_price: Number(event.own_total_price) || 0,
        vehicle_type_manual: Number(event.vehicle_type_manual) || 0,
        vehicle_type_automatic: Number(event.vehicle_type_automatic) || 0,
        vehicle_type_own: Number(event.vehicle_type_own) || 0,
        vat: Number(event.vat) || 0,
        vTypeSelect: event.vTypeSelect,
      },
      showDepositWarning,
      spaceRequired: Number(adminBooking.space_required),
      manualAvail,
      autoAvail,
      moveToEvents: moveToevents.events,
      attendeeDefaults,
      licenceTypes: await getLicenceTypes(pool),
      bookingData: savedBookingData,
      preFillData,
      promoData: adminBooking.BookingPromoData || null,
      adminOriginalAmount,
      lockTimer: buildLockTimer(req.session),
      evId,
    },
  };
}

async function switchWizardEvent(pool, req, newEventId, adminId) {
  const adminBooking = requireAdminBookingSession(req);
  if (!adminBooking) {
    return { ok: false, message: 'Invalid course, Try again', redirect: '/admin/dashboard' };
  }

  const nextEventId = Number(newEventId);
  if (!Number.isFinite(nextEventId) || nextEventId <= 0) {
    return { ok: false, message: 'Invalid course, Try again' };
  }

  if (Number(adminBooking.eventId) === nextEventId) {
    return loadWizard(pool, req);
  }

  const spaceRequired = Number(adminBooking.space_required);
  const lockId = adminBooking.lock_session?.id;
  if (lockId) {
    await removeCurLock(pool, req.session, lockId, false);
  }

  req.session.adminBooking = {
    space_required: spaceRequired,
    eventId: String(nextEventId),
  };

  const lockResult = await lockBooking(pool, req, nextEventId, spaceRequired, adminId);
  if (!lockResult.ok) {
    return lockResult;
  }

  return loadWizard(pool, req);
}

async function submitWizardAttendees(pool, req, body, adminId) {
  delete req.session.blacklisted;

  const adminBooking = await resolveAdminBookingSession(pool, req);
  if (!adminBooking) {
    const evId = Number(req.session?.adminBooking?.eventId);
    return {
      ok: false,
      code: 'SESSION_EXPIRED',
      message: 'Your booking session has expired. Please lock spaces again.',
      redirect: Number.isFinite(evId) && evId > 0
        ? `/admin/bookings/events/${evId}`
        : '/admin/dashboard',
    };
  }

  const evId = Number(adminBooking.eventId);
  const ce = await getEvent(pool, evId, req.session);
  if (!ce) {
    return { ok: false, message: 'Invalid course, Try again', redirect: '/admin/dashboard' };
  }

  const submitted = body?.BA || body?.attendees || {};
  const blacklistData = {};
  let blacklisted = false;
  for (const [key, att] of Object.entries(submitted)) {
    if (!att || typeof att !== 'object' || key === 'world_payment') {
      continue;
    }
    const row = await checkBlacklisted(pool, att.license_number);
    if (row) {
      blacklisted = true;
      blacklistData[key] = row;
    }
  }
  if (blacklisted) {
    req.session.blacklisted = { status: 1, data: blacklistData };
    return {
      ok: false,
      code: 'BLACKLISTED',
      blacklisted: req.session.blacklisted,
    };
  }

  req.session.adminBooking.Booking_data = submitted;
  const lockUpdate = await updateVehicleLocks(pool, req, ce, submitted);
  if (!lockUpdate.ok) {
    return lockUpdate;
  }

  const [eventCheck] = await pool.query(
    `SELECT id, course_id FROM course_events
     WHERE course_events.id = ? AND booking_limit > bookings_done`,
    [evId]
  );
  if (!eventCheck[0]) {
    await removeCurLock(pool, req.session);
    delete req.session.adminBooking;
    return {
      ok: false,
      code: 'EVENT_FULL',
      message: 'This course is fully booked. Please choose another date.',
      redirect: '/admin/dashboard',
    };
  }

  const moto =
    body?.world_payment || body?.BA?.world_payment || body?.moto_payment ? 'yes' : 'no';
  req.session.motoPaymentBookings = [];
  req.session.worldPaymentBookings = [];
  const bookingRefs = [];

  for (const [ak, bd] of Object.entries(submitted)) {
    if (!bd || typeof bd !== 'object' || ak === 'world_payment') {
      continue;
    }
    const payload = {
      attendee: bd,
      course_id: eventCheck[0].course_id,
      course_event_id: eventCheck[0].id,
      course_cost: bd.course_cost,
      payment_received: bd.payment_received,
    };
    const bookingRef = await saveBookingWorld(pool, req, payload, moto, ce, adminId);
    req.session.adminBooking.Booking_data[ak].booking_ref = bookingRef;
    bookingRefs.push(bookingRef);
  }

  if (moto === 'yes' && req.session.worldPaymentBookings?.length) {
    return {
      ok: true,
      paymentMode: 'stripe',
      redirect: '/admin/bookings/payment/stripe',
      bookingRefs,
    };
  }

  const spaceRequired = Number(adminBooking.space_required);
  await addBookingsDone(pool, req, evId, spaceRequired);

  return {
    ok: true,
    paymentMode: 'cash',
    redirect: `/admin/bookings/confirmation/cash?evId=${evId}`,
    bookingRefs,
  };
}

async function checkPromoCode(pool, req, body) {
  const adminBooking = requireAdminBookingSession(req);
  const response = {
    status: 0,
    is_promo_code_valid: 0,
    promo_message: 'Promo Code is not valid.',
    amtOArr: req.session.adminOriginalAmount || {},
  };

  if (!adminBooking) {
    return response;
  }

  const promocode = trim(body?.promocode).toUpperCase();
  const vehTypesReq = body?.veh_types_req || {};
  const licences = body?.licences || {};
  const spaceRequired = Number(adminBooking.space_required);

  if (
    !promocode ||
    !vehTypesReq ||
    Object.keys(vehTypesReq).length !== spaceRequired
  ) {
    req.session.adminBooking.BookingPromoData = response;
    return response;
  }

  const [promoRows] = await pool.query(
    'SELECT * FROM promos WHERE promo_code = ? AND status = 1 AND isDeleted = 0 LIMIT 1',
    [promocode]
  );
  const promoData = promoRows[0];
  if (!promoData) {
    req.session.adminBooking.BookingPromoData = response;
    return response;
  }

  const evId = Number(adminBooking.eventId);
  const ce = await getEvent(pool, evId, req.session);
  const show = showDepositPrice(ce);
  const bookingCourseId = Number(adminBooking.courseId);
  const bookingLocationId = Number(ce.location_id);
  const bookingFranchiseId = Number(ce.franchise_id);

  const [eventDateRows] = await pool.query(
    `SELECT event_date FROM course_event_dates
     WHERE course_event_id = ? AND event_date != '0000-00-00'
     ORDER BY event_date ASC LIMIT 1`,
    [evId]
  );
  let checkDate = '';
  let eventDate = '';
  if (eventDateRows[0]) {
    checkDate = new Date(eventDateRows[0].event_date).toLocaleDateString('en-GB', {
      weekday: 'short',
    });
    eventDate = formatDateValue(eventDateRows[0].event_date);
  }

  const today = formatDateValue(new Date());
  const activeBetween =
    Number(promoData.p_c_active_between) === 1 ||
    (today >= formatDateValue(promoData.p_c_active_from_date) &&
      today <= formatDateValue(promoData.p_c_active_to_date));

  if (!activeBetween) {
    req.session.adminBooking.BookingPromoData = response;
    return response;
  }

  const scopeOk =
    (Number(promoData.p_c_course) === 1 ||
      bookingCourseId === Number(promoData.p_c_course_id)) &&
    (Number(promoData.p_c_location) === 1 ||
      bookingLocationId === Number(promoData.p_c_location_id)) &&
    (Number(promoData.p_c_franchise) === 1 ||
      bookingFranchiseId === Number(promoData.p_c_franchise_id));

  if (!scopeOk || spaceRequired < Number(promoData.p_c_min_booking)) {
    req.session.adminBooking.BookingPromoData = response;
    return response;
  }

  const dayOk =
    Number(promoData.p_c_days) === 1 ||
    String(promoData.p_c_day || '').includes(checkDate);
  const dateOk =
    Number(promoData.p_c_dates_between) === 1 ||
    (eventDate >= formatDateValue(promoData.p_c_from_date) &&
      eventDate <= formatDateValue(promoData.p_c_to_date));

  if (!dayOk || !dateOk) {
    req.session.adminBooking.BookingPromoData = response;
    return response;
  }

  let isValidPromo = false;
  if (promoData.p_c_for === 'anyone') {
    isValidPromo = true;
  } else {
    let isError = 0;
    for (const licence of Object.values(licences)) {
      const value = trim(licence);
      if (!value) {
        continue;
      }
      const [countRows] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM booking_attendees WHERE license_number = ?',
        [value]
      );
      if (Number(countRows[0]?.cnt) === 0) {
        isError = 1;
        break;
      }
    }
    if (!Object.values(licences).some((v) => trim(v))) {
      isError = 1;
    }
    if (isError === 0) {
      isValidPromo = true;
    }
  }

  if (!isValidPromo) {
    req.session.adminBooking.BookingPromoData = response;
    return response;
  }

  const paymentType =
    Number(ce.school_deposit_price) > 0 || Number(ce.own_deposit_price) > 0
      ? show
        ? 'on_off'
        : 'deposit'
      : 'on_off';

  const feesArr = calculateCourseAmount(ce, vehTypesReq);
  let amountAfterDiscount = show ? feesArr.attFee[1]?.total || feesArr.fee : feesArr.fee;
  amountAfterDiscount = calculateDisAmt(
    promoData.p_c_discount_type,
    promoData.p_c_amount,
    amountAfterDiscount
  );

  const amtArr = {};
  let paramString = '';
  let aKey = 1;
  for (const [, sub] of Object.entries(vehTypesReq)) {
    if (sub === '' || sub == null) {
      continue;
    }
    const vehicleType = Number(sub);
    let discounted = amountAfterDiscount;
    if (vehicleType === 3) {
      if (Number(ce.own_one_off_price) > 0) {
        discounted = calculateDisAmt(
          promoData.p_c_discount_type,
          promoData.p_c_amount,
          ce.own_one_off_price
        );
        paramString += `<p> £<span id="final_fee_amount">${discounted.toFixed(2)}</span> using your own vehicle</p>`;
        amtArr[aKey] = { one_off_price: discounted };
      } else if (Number(ce.own_deposit_price) > 0) {
        discounted = calculateDisAmt(
          promoData.p_c_discount_type,
          promoData.p_c_amount,
          ce.own_total_price
        );
        paramString += `<p> £<span id="final_fee_amount">${discounted.toFixed(2)}</span> using your own vehicle</p>`;
        amtArr[aKey] = { total_price: discounted };
      }
    } else if (Number(ce.school_one_off_price) > 0) {
      discounted = calculateDisAmt(
        promoData.p_c_discount_type,
        promoData.p_c_amount,
        ce.school_one_off_price
      );
      paramString += `<p> £<span id="final_fee_amount">${discounted.toFixed(2)}</span> using our school vehicle</p>`;
      amtArr[aKey] = { one_off_price: discounted };
    } else if (Number(ce.school_deposit_price) > 0) {
      discounted = calculateDisAmt(
        promoData.p_c_discount_type,
        promoData.p_c_amount,
        ce.school_total_price
      );
      paramString += `<p> £<span id="final_fee_amount">${discounted.toFixed(2)}</span> using our school vehicle</p>`;
      amtArr[aKey] = { total_price: discounted };
    }
    aKey += 1;
  }

  const success = {
    status: 1,
    is_promo_code_valid: 1,
    promo_id: promoData.id,
    payment_type: paymentType,
    amount_after_discount: amountAfterDiscount,
    param_string: paramString,
    amtArr,
    promo_message: 'Promo Code Accepted.',
    promo_suc_message: 'Promo Code Accepted.',
    amtOArr: req.session.adminOriginalAmount || {},
  };
  req.session.adminBooking.BookingPromoData = success;
  return success;
}

async function cancelPromoCode(req) {
  const response = {
    status: 0,
    is_promo_code_valid: 0,
    promo_message: 'Promo Code is not valid.',
    amtOArr: req.session.adminOriginalAmount || {},
  };
  if (req.session?.adminBooking) {
    delete req.session.adminBooking.BookingPromoData;
  }
  return response;
}

async function loadCashConfirmation(pool, req, evId) {
  const bookingIds = req.session?.worldPaymentBookings;
  if (!bookingIds?.length) {
    return {
      ok: false,
      message: 'No booking found',
      redirect: '/admin/dashboard',
    };
  }

  const vTypeSelect = {
    '0': 'Manual',
    '1': 'Automatic',
    '3': 'I will be using my own vehicle',
  };
  const typeOfBook = {
    m: 'Moto',
    o: 'Online',
    t: 'Terminal',
    w: 'Worldpay',
    r: 'RideTo',
  };
  const licenceTypes = await getLicenceTypes(pool);
  const attendees = [];

  for (const bookingId of bookingIds) {
    const [rows] = await pool.query(
      `SELECT bookings.*, bookings.created AS bcreated,
        courses.course_name, courses.course_abb, courses.cancel_price,
        course_events.id AS course_event_id,
        locations.location_name, locations.address1, locations.address2,
        locations.address3, locations.address4, locations.postcode,
        franchise.franchise_name,
        booking_attendees.*
       FROM bookings
       JOIN course_events ON course_events.id = bookings.course_event_id
       JOIN courses ON courses.id = bookings.course_id
       JOIN locations ON locations.id = course_events.location_id
       JOIN franchise ON franchise.id = course_events.franchise_id
       JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
       WHERE bookings.id = ?
       LIMIT 1`,
      [bookingId]
    );
    const row = rows[0];
    if (!row) {
      continue;
    }

    const [dateRows] = await pool.query(
      'SELECT * FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date ASC',
      [row.course_event_id]
    );
    const dates = {};
    for (const dateRow of dateRows || []) {
      const key = formatDateValue(dateRow.event_date);
      if (key && key !== '0000-00-00') {
        dates[key] = `${String(dateRow.event_start_time || '').slice(0, 5)} - ${String(dateRow.event_end_time || '').slice(0, 5)}`;
      }
    }

    let promoCode = null;
    if (Number(row.is_promo_applied) === 1 && Number(row.promo_code_id) > 0) {
      const [promoRows] = await pool.query('SELECT * FROM promos WHERE id = ?', [
        row.promo_code_id,
      ]);
      promoCode = promoRows[0] || null;
    }

    attendees.push({
      booking_id: row.id,
      booking_ref: row.booking_ref,
      course_name: row.course_name,
      course_abb: row.course_abb,
      dates,
      location_name: row.location_name,
      address1: row.address1,
      address2: row.address2,
      address3: row.address3,
      address4: row.address4,
      postcode: row.postcode,
      franchise_name: row.franchise_name,
      created: row.bcreated,
      type_of_book: typeOfBook[row.type_of_book] || row.type_of_book,
      first_name: row.first_name,
      sur_name: row.sur_name,
      contact1: row.contact1,
      contact2: row.contact2,
      date_of_birth: row.date_of_birth,
      email: row.email,
      vehicle_type: vTypeSelect[String(row.vehicle_type)] || '',
      total_fees: Number(row.total_fees) || 0,
      payment_received: Number(row.total_amount) - Number(row.payment_due),
      payment_due: Number(row.payment_due) || 0,
      license_type:
        licenceTypes.find((lt) => Number(lt.id) === Number(row.license_type))
          ?.licence_type || '',
      license_number: row.license_number,
      theory_number: row.theory_number,
      admin_notes: row.admin_notes,
      notes: row.notes,
      promoCode,
    });
  }

  delete req.session.worldPaymentBookings;
  if (req.session.motoPaymentBookings) {
    delete req.session.motoPaymentBookings;
  }

  return {
    ok: true,
    data: {
      evId: Number(evId),
      attendees,
    },
  };
}

module.exports = {
  loadWizard,
  switchWizardEvent,
  submitWizardAttendees,
  checkPromoCode,
  cancelPromoCode,
  loadCashConfirmation,
  searchExistingCustomers,
  getExistingCustomerById,
  saveBookingCompleteWorld,
  addBookingsDone,
  getLockBooking,
  timeAmPm,
  ensureAdminBookingSession,
  requireAdminBookingSession,
  refreshAdminBookingLock,
  resolveAdminBookingSession,
};
