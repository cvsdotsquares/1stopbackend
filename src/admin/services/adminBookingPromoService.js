/**
 * Admin add-booking promo — port of legacy ajaxFile.php checkPromoCode / cancelPromoCode
 * and booking.class.php calculateDisAmt / calculateCoursAmount.
 */
const { removeExpirelocks } = require('./bookingService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
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

function normalizeStringArray(value, length) {
  const arr = [];
  if (Array.isArray(value)) {
    for (let i = 0; i < length; i += 1) {
      arr.push(trim(value[i]));
    }
  } else if (value && typeof value === 'object') {
    for (let i = 1; i <= length; i += 1) {
      arr.push(trim(value[String(i)] ?? value[i]));
    }
  }
  while (arr.length < length) arr.push('');
  return arr.slice(0, length);
}

function toDateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw || raw.startsWith('0000-00-00')) return '';
  return raw.slice(0, 10);
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

/** Legacy events.class.php showDepositPrice — true when within cancellation period. */
function showDepositPrice(ce, firstEventDate) {
  const schoolDeposit = Number(ce.school_deposit_price) || 0;
  const isDeposit = Number(ce.is_deposit) || 0;
  if (!(schoolDeposit > 0 && isDeposit > 0) || !firstEventDate) {
    return false;
  }
  const depositPeriod = Number(ce.deposit_days ?? ce.cancel_days ?? 0) || 0;
  const depositCal = new Date();
  depositCal.setDate(depositCal.getDate() + depositPeriod + 1);
  const depositCalDate = depositCal.toISOString().slice(0, 10);
  return depositCalDate > firstEventDate;
}

/** Legacy booking.class.php calculateDisAmt */
function calculateDisAmt(discountType, discountAmount, amount) {
  const base = Number(amount) || 0;
  if (!base) return 0;
  let after = base;
  if (discountType === 'pounds_off') {
    after = base - Number(discountAmount || 0);
  } else if (discountType === 'percent_off') {
    after = base - (base * Number(discountAmount || 0)) / 100;
  }
  return round2(Math.max(0, after));
}

function resolvePaymentTypeWithShow(ce, show) {
  const hasDeposit =
    Number(ce.own_deposit_price) > 0 || Number(ce.school_deposit_price) > 0;
  if (!hasDeposit) return 'on_off';
  return show ? 'on_off' : 'deposit';
}

/** Legacy ajaxFile.php per-attendee amtArr builder. */
function buildLegacyAttendeePromoAmounts(ce, show, vehicleType, promo) {
  const sub = Number(vehicleType);
  const entry = {};
  const { p_c_discount_type: discountType, p_c_amount: discountAmount } = promo;

  if (sub === 3) {
    if (Number(ce.vehicle_type_own)) {
      if (Number(ce.own_one_off_price)) {
        entry.one_off_price = calculateDisAmt(
          discountType,
          discountAmount,
          ce.own_one_off_price
        );
      } else if (Number(ce.own_deposit_price)) {
        entry.total_price = calculateDisAmt(
          discountType,
          discountAmount,
          ce.own_total_price
        );
      }
    } else if (Number(ce.school_one_off_price)) {
      entry.one_off_price = calculateDisAmt(
        discountType,
        discountAmount,
        ce.school_one_off_price
      );
    } else if (Number(ce.school_deposit_price)) {
      entry.total_price = calculateDisAmt(
        discountType,
        discountAmount,
        ce.school_total_price
      );
    }
  } else if (sub === 0 || sub === 1) {
    if (Number(ce.school_one_off_price)) {
      entry.one_off_price = calculateDisAmt(
        discountType,
        discountAmount,
        ce.school_one_off_price
      );
    } else if (Number(ce.school_deposit_price)) {
      entry.total_price = calculateDisAmt(
        discountType,
        discountAmount,
        ce.school_total_price
      );
    }
  }

  return entry;
}

function buildLegacyOriginalEntry(ce, show, vehicleType, savedRow) {
  if (savedRow?.course_cost != null) {
    const courseCost = Number(savedRow.course_cost) || 0;
    const received = Number(savedRow.payment_received ?? savedRow.received) || 0;
    const outstanding =
      savedRow.amount_outstanding != null
        ? Number(savedRow.amount_outstanding) || 0
        : savedRow.outstanding != null
          ? Number(savedRow.outstanding) || 0
          : Math.max(0, courseCost - received);
    return { course_cost: courseCost, received, outstanding };
  }

  const sub = Number(vehicleType);
  if (Number(ce.school_one_off_price)) {
    const price = Number(ce.school_one_off_price);
    return { course_cost: price, received: price, outstanding: 0 };
  }
  if (Number(ce.school_deposit_price)) {
    const total = show
      ? Number(ce.school_total_price) || 0
      : Number(ce.school_total_price) || 0;
    const deposit = show
      ? total
      : Number(ce.school_deposit_price) || 0;
    return {
      course_cost: total,
      received: deposit,
      outstanding: Math.max(0, total - deposit),
    };
  }
  if (sub === 3 && Number(ce.own_one_off_price)) {
    const price = Number(ce.own_one_off_price);
    return { course_cost: price, received: price, outstanding: 0 };
  }
  if (sub === 3 && Number(ce.own_deposit_price)) {
    const total = Number(ce.own_total_price) || 0;
    const deposit = show ? total : Number(ce.own_deposit_price) || 0;
    return {
      course_cost: total,
      received: deposit,
      outstanding: Math.max(0, total - deposit),
    };
  }
  return { course_cost: 0, received: 0, outstanding: 0 };
}

function syncAdminOriginalAmount(adminBooking, ce, show, vehicleTypes, savedAttendees) {
  const spaceRequired = Number(adminBooking.space_required) || 0;
  const original = {};
  for (let i = 0; i < spaceRequired; i += 1) {
    const key = String(i + 1);
    const saved = savedAttendees?.[key] || savedAttendees?.[i + 1];
    original[key] = buildLegacyOriginalEntry(
      ce,
      show,
      vehicleTypes[i],
      saved
    );
  }
  adminBooking.adminOriginalAmount = original;
  return original;
}

async function fetchPromoByCode(pool, promoCode) {
  const [rows] = await pool.query(
    `SELECT * FROM promos
     WHERE promo_code = ? AND status = 1 AND isDeleted = 0
     LIMIT 1`,
    [promoCode]
  );
  return rows?.[0] || null;
}

async function getEventForPromo(pool, eventId) {
  const [rows] = await pool.query(
    `SELECT course_events.*,
            courses.deposit_days,
            courses.cancel_days
     FROM course_events
     LEFT JOIN courses ON courses.id = course_events.course_id
     WHERE course_events.id = ?
     LIMIT 1`,
    [eventId]
  );
  return rows?.[0] || null;
}

async function validateExistingCustomerLicenses(pool, licenses) {
  if (!licenses || !licenses.length) return false;

  let checkedAny = false;
  for (const licence of licenses) {
    const trimmed = trim(licence);
    if (!trimmed) continue;
    checkedAny = true;
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM booking_attendees WHERE license_number = ?',
      [trimmed]
    );
    if (Number(rows?.[0]?.cnt || 0) === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Legacy ajaxFile.php validation block (expiry intentionally bypassed in admin).
 */
function isLegacyPromoValid(promo, context) {
  const {
    bookingCourseId,
    bookingLocationId,
    bookingFranchiseId,
    bookingNo,
    eventDate,
    eventDayAbbr,
    skipDayCheck,
    licenses,
  } = context;

  const today = todayDateOnly();
  const activeFrom = toDateOnly(promo.p_c_active_from_date);
  const activeTo = toDateOnly(promo.p_c_active_to_date);
  const activeOk =
    Number(promo.p_c_active_between) === 1 ||
    (today >= activeFrom && today <= activeTo);
  if (!activeOk) return false;

  const courseOk =
    Number(promo.p_c_course) === 1 ||
    Number(bookingCourseId) === Number(promo.p_c_course_id);
  const locationOk =
    Number(promo.p_c_location) === 1 ||
    Number(bookingLocationId) === Number(promo.p_c_location_id);
  const franchiseOk =
    Number(promo.p_c_franchise) === 1 ||
    Number(bookingFranchiseId) === Number(promo.p_c_franchise_id);
  if (!(courseOk && locationOk && franchiseOk)) return false;

  if (bookingNo < Number(promo.p_c_min_booking || 0)) return false;

  const daysOk =
    skipDayCheck ||
    Number(promo.p_c_days) === 1 ||
    String(promo.p_c_day || '').includes(eventDayAbbr);
  if (!daysOk) return false;

  const dateFrom = toDateOnly(promo.p_c_from_date);
  const dateTo = toDateOnly(promo.p_c_to_date);
  const datesOk =
    Number(promo.p_c_dates_between) === 1 ||
    (eventDate >= dateFrom && eventDate <= dateTo);
  if (!datesOk) return false;

  return true;
}

async function checkAdminBookingPromoCode(pool, session, body = {}) {
  await removeExpirelocks(pool, session);
  const adminBooking = requireActiveBookingSession(session);
  const spaceRequired = Number(adminBooking.space_required) || 0;
  const promocode = trim(body.promocode || body.promo_code).toUpperCase();

  const invalidResponse = () => ({
    status: 0,
    is_promo_code_valid: 0,
    promo_message: 'Promo Code is not valid.',
    amtOArr: adminBooking.adminOriginalAmount || {},
  });

  if (!promocode) {
    const err = new Error('Promo code is required');
    err.status = 400;
    throw err;
  }

  const vehicleTypes = normalizeStringArray(
    body.veh_types_req || body.vehicle_types,
    spaceRequired
  );
  if (
    !vehicleTypes.length ||
    vehicleTypes.length !== spaceRequired ||
    vehicleTypes.some((value) => value === '')
  ) {
    const err = new Error('Please select Vehical tye for each Attendee');
    err.status = 400;
    throw err;
  }

  const licenseNumbers = normalizeStringArray(
    body.licences || body.license_numbers,
    spaceRequired
  );

  const promo = await fetchPromoByCode(pool, promocode);
  if (!promo) {
    return invalidResponse();
  }

  const eventId = Number(adminBooking.eventId);
  const ce = await getEventForPromo(pool, eventId);
  if (!ce?.id) {
    const err = new Error('Invalid course, Try again');
    err.status = 404;
    throw err;
  }

  const [dateRows] = await pool.query(
    `SELECT event_date FROM course_event_dates
     WHERE course_event_id = ? AND event_date != '0000-00-00'
     ORDER BY event_date ASC LIMIT 1`,
    [eventId]
  );

  let eventDate = '';
  let eventDayAbbr = '';
  let skipDayCheck = false;
  let promoForValidation = promo;

  if (dateRows?.[0]?.event_date) {
    eventDate = toDateOnly(dateRows[0].event_date);
    eventDayAbbr = new Date(`${eventDate}T12:00:00`).toLocaleDateString(
      'en-US',
      { weekday: 'short' }
    );
  } else {
    skipDayCheck = true;
    promoForValidation = { ...promo, p_c_days: 1 };
  }

  const show = showDepositPrice(ce, eventDate);
  syncAdminOriginalAmount(
    adminBooking,
    ce,
    show,
    vehicleTypes,
    adminBooking.Booking_data || {}
  );

  let isValidPromo = isLegacyPromoValid(promoForValidation, {
    bookingCourseId: adminBooking.courseId || ce.course_id,
    bookingLocationId: ce.location_id,
    bookingFranchiseId: ce.franchise_id,
    bookingNo: spaceRequired,
    eventDate,
    eventDayAbbr,
    skipDayCheck,
    licenses: licenseNumbers,
  });

  if (isValidPromo && promo.p_c_for !== 'anyone') {
    isValidPromo = await validateExistingCustomerLicenses(pool, licenseNumbers);
  }

  if (!isValidPromo) {
    return invalidResponse();
  }

  const paymentType = resolvePaymentTypeWithShow(ce, show);
  const amtArr = {};
  let amountAfterDiscount = 0;
  let paramString = '';

  vehicleTypes.forEach((vehicleType, index) => {
    const key = String(index + 1);
    const entry = buildLegacyAttendeePromoAmounts(ce, show, vehicleType, promo);
    if (Object.keys(entry).length) {
      amtArr[key] = entry;
      if (entry.one_off_price != null) {
        amountAfterDiscount = entry.one_off_price;
        paramString += `<p> &pound;<span id="final_fee_amount">${entry.one_off_price.toFixed(2)}</span> using our school vehicle</p>`;
      } else if (entry.total_price != null) {
        amountAfterDiscount = entry.total_price;
        paramString += `<p> &pound;<span id="final_fee_amount">${entry.total_price.toFixed(2)}</span> using our school vehicle</p>`;
      }
    }
  });

  const response = {
    status: 1,
    is_promo_code_valid: 1,
    promo_id: promo.id,
    payment_type: paymentType,
    amount_after_discount: amountAfterDiscount,
    param_string: paramString,
    amtArr,
    promo_message: 'Promo Code Accepted.',
    promo_suc_message: 'Promo Code Accepted.',
    promo_code: promo.promo_code,
    amtOArr: adminBooking.adminOriginalAmount || {},
  };

  adminBooking.BookingPromoData = response;
  return response;
}

function cancelAdminBookingPromoCode(session) {
  const adminBooking = requireActiveBookingSession(session);
  const response = {
    status: 0,
    is_promo_code_valid: 0,
    promo_message: 'Promo Code is not valid.',
    amtOArr: adminBooking.adminOriginalAmount || {},
  };
  delete adminBooking.BookingPromoData;
  return response;
}

module.exports = {
  checkAdminBookingPromoCode,
  cancelAdminBookingPromoCode,
  syncAdminOriginalAmount,
  showDepositPrice,
  calculateDisAmt,
};
