/**
 * F-017 — Edit / view booking (legacy edit_booking.php, view_booking_details.php).
 */
const { isEventFrozen } = require('./courseEventWizardService');
const { sendAdminBookingConfirmationEmail } = require('./adminBookingEmailService');
const { getCurrentMysqlDateTime } = require('../../utils/dateFormat');

const TBC_DATE = '0000-00-00';

const TOB_LABELS = {
  m: 'MOTO',
  o: 'Online',
  t: 'Terminal',
  w: 'Worldpay',
  r: 'RideTo',
};

const VEHICLE_TYPE_LABELS = {
  0: 'Manual',
  1: 'Automatic',
  3: 'I will be using my own vehicle',
};

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function toMysqlDateKey(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const raw = trim(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }
  return '';
}

function titleCase(value) {
  const s = trim(value);
  if (!s) return '';
  return s.replace(/\w\S*/g, (txt) =>
    txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
  );
}

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '£0.00';
  return `£${n.toFixed(2)}`;
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
  const day = d.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th';
  return `${weekdays[d.getDay()]} ${day}${suffix} ${months[d.getMonth()]} ${d.getFullYear()}`;
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

function formatDateTimeLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
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
  return `${weekdays[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatHistoryTimestamp(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} @ ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateOfBirthDisplay(value) {
  if (!value || value === '0000-00-00') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
  }
  const raw = trim(String(value));
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return raw;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()}`;
  }
  return raw;
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
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }
  return '';
}

function buildEventDatesMap(dateRows) {
  const dates = {};
  let hasTbc = false;
  for (const row of dateRows || []) {
    const raw = row.event_date;
    if (raw && String(raw).slice(0, 10) !== TBC_DATE) {
      dates[String(raw).slice(0, 10)] =
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

function formatAddress4(value) {
  const slug = trim(value);
  const map = {
    '1-stop-instruction-ilford': 'Ilford (Fairlop Powerleague)',
    '1-stop-instruction-beckton': 'Beckton (Newham Powerleague)',
    '1-stop-instruction-barnet': 'Barnet',
    '1-stop-instruction-tottenham': 'Tottenham (Frederick Knight Sports Ground)',
  };
  return map[slug] || slug;
}

function buildLocationLines(event) {
  const lines = [];
  if (event.location_name) lines.push(event.location_name);
  if (event.address1) lines.push(event.address1);
  if (event.address2) lines.push(event.address2);
  if (event.address3) lines.push(event.address3);
  const a4 = formatAddress4(event.address4);
  if (a4) lines.push(a4);
  if (event.postcode) lines.push(event.postcode);
  return lines;
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

async function resolveBookingAttendee(pool, idParam) {
  const key = trim(idParam);
  if (!key) return null;

  const { where, params } = await getFranchiseRefConditions(pool, key);
  const [rows] = await pool.query(
    `SELECT booking_attendees.*, bookings.course_event_id, bookings.status AS booking_status
     FROM booking_attendees
     LEFT JOIN bookings ON booking_attendees.booking_id = bookings.id
     WHERE ${where}
     ORDER BY booking_attendees.\`primary\` DESC
     LIMIT 1`,
    params
  );
  return rows?.[0] || null;
}

async function findDeletedBookingRedirect(pool, idParam) {
  const key = trim(idParam);
  const [rows] = await pool.query(
    `SELECT booking_id FROM deleted_bookings
     WHERE booking_id = ? OR booking_ref LIKE ?
     ORDER BY id ASC LIMIT 1`,
    [key, `%${key}%`]
  );
  return rows?.[0]?.booking_id || null;
}

async function loadBookingCore(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT bookings.*,
            bookings.created AS booking_created,
            booking_attendees.id AS attendee_id,
            booking_attendees.booking_ref,
            booking_attendees.first_name,
            booking_attendees.sur_name,
            booking_attendees.contact1,
            booking_attendees.contact2,
            booking_attendees.contact3,
            booking_attendees.date_of_birth,
            booking_attendees.email,
            booking_attendees.vehicle_type,
            booking_attendees.license_type,
            booking_attendees.license_number,
            booking_attendees.theory_number,
            booking_attendees.admin_notes,
            booking_attendees.notes,
            booking_attendees.contact_card_id,
            courses.course_name,
            courses.course_abb,
            courses.cancel_price,
            courses.deposit_days,
            courses.cancel_days,
            courses.dsa_fees,
            locations.location_name,
            locations.address1,
            locations.address2,
            locations.address3,
            locations.address4,
            locations.postcode,
            locations.loc_abb,
            franchise.franchise_name,
            franchise.vat AS franchise_vat,
            course_events.is_deposit,
            course_events.school_one_off_price,
            course_events.school_deposit_price,
            course_events.school_total_price,
            course_events.own_one_off_price,
            course_events.own_deposit_price,
            course_events.own_total_price,
            course_events.vehicle_type_manual,
            course_events.vehicle_type_automatic,
            course_events.vehicle_type_own,
            course_events.manual_lock_done,
            course_events.automatic_lock_done
     FROM bookings
     JOIN course_events ON course_events.id = bookings.course_event_id
     JOIN courses ON courses.id = bookings.course_id
     JOIN locations ON locations.id = course_events.location_id
     JOIN franchise ON franchise.id = course_events.franchise_id
     JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     WHERE bookings.id = ?
     ORDER BY booking_attendees.\`primary\` DESC
     LIMIT 1`,
    [bookingId]
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

function getVehicleTypeOptions(event, currentVehicleType, vtypeTrue = true) {
  const options = [];
  const manualAvail =
    Number(event.vehicle_type_manual || 0) -
    Number(event.manual_lock_done || 0);
  const autoAvail =
    Number(event.vehicle_type_automatic || 0) -
    Number(event.automatic_lock_done || 0);
  const current = Number(currentVehicleType);

  if (
    (Number(event.vehicle_type_automatic) > 0 && autoAvail > 0) ||
    (current === 1 && vtypeTrue)
  ) {
    options.push({ value: 1, label: VEHICLE_TYPE_LABELS[1] });
  }
  if (
    (Number(event.vehicle_type_manual) > 0 && manualAvail > 0) ||
    (current === 0 && vtypeTrue)
  ) {
    options.push({ value: 0, label: VEHICLE_TYPE_LABELS[0] });
  }
  if (Number(event.vehicle_type_own) === 1) {
    options.push({ value: 3, label: VEHICLE_TYPE_LABELS[3] });
  }
  return options;
}

async function getMoveToEvents(pool, courseId, currentEventId) {
  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT locations.location_name,
              course_event_dates.course_event_id,
              MIN(course_event_dates.event_date) AS event_date,
              course_event_dates.event_start_time,
              course_event_dates.event_end_time,
              course_events.booking_limit,
              course_events.bookings_done,
              course_events.current_locks
       FROM course_event_dates
       JOIN course_events ON course_events.id = course_event_dates.course_event_id
       JOIN courses ON courses.id = course_events.course_id
       JOIN locations ON locations.id = course_events.location_id
       WHERE course_events.status = '1'
         AND courses.status IN ('1', '2')
         AND course_event_dates.event_date != '0000-00-00'
         AND course_events.booking_limit > (course_events.bookings_done + course_events.current_locks)
         AND courses.id = ?
       GROUP BY course_event_id
       HAVING MIN(course_event_dates.event_date) >= CURDATE()
       ORDER BY course_event_dates.course_event_id, course_event_dates.event_date
     ) sq
     GROUP BY sq.course_event_id
     ORDER BY sq.event_date ASC, sq.location_name ASC, sq.event_start_time ASC`,
    [courseId]
  );

  const today = getCurrentMysqlDateTime().slice(0, 10);
  const frozenIds = new Set();
  const candidateIds = (rows || [])
    .map((row) => Number(row.course_event_id))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (candidateIds.length) {
    const chunkSize = 500;
    for (let i = 0; i < candidateIds.length; i += chunkSize) {
      const chunk = candidateIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const [frozenRows] = await pool.query(
        `SELECT course_event_id FROM freeze WHERE course_event_id IN (${placeholders})`,
        chunk
      );
      for (const frozenRow of frozenRows || []) {
        frozenIds.add(Number(frozenRow.course_event_id));
      }
    }
  }

  const options = [];
  for (const row of rows || []) {
    const eventId = Number(row.course_event_id);
    if (eventId === Number(currentEventId)) continue;
    const eventDate = toMysqlDateKey(row.event_date);
    if (!eventDate || eventDate < today) continue;
    if (frozenIds.has(eventId)) continue;
    const limit = Number(row.booking_limit) || 0;
    const done = Number(row.bookings_done) || 0;
    const locks = Number(row.current_locks) || 0;
    if (limit <= done + locks) continue;

    const start = row.event_start_time
      ? String(row.event_start_time).slice(0, 5)
      : '';
    const end = row.event_end_time
      ? String(row.event_end_time).slice(0, 5)
      : '';
    options.push({
      course_event_id: eventId,
      event_date: eventDate,
      event_date_label: formatLongDate(eventDate),
      location_name: row.location_name || '',
      timings: `${start} - ${end}`.trim(),
      label: `${formatLongDate(eventDate)} — ${row.location_name || ''} — ${start} - ${end}`.trim(),
    });
  }
  options.sort((a, b) => a.event_date.localeCompare(b.event_date));
  return options;
}

async function loadUpdateHistory(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT booking_update_history.*,
            CONCAT(admin.admin_fristname, ' ', admin.admin_lastname) AS admin_name
     FROM booking_update_history
     LEFT JOIN admin ON admin.admin_id = booking_update_history.updated_by_admin_id
     WHERE booking_update_history.booking_id = ?
     ORDER BY booking_update_history.created DESC`,
    [bookingId]
  );
  return (rows || []).map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    admin_name: trim(row.admin_name) || 'Admin',
    created: row.created,
    created_label: formatHistoryTimestamp(row.created),
  }));
}

async function loadStudentResult(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT student_daily_report.*,
            itinary_result_options.option AS result_option
     FROM student_daily_report
     JOIN itinary_result_options ON itinary_result_options.id = student_daily_report.report
     WHERE student_daily_report.booking_id = ?
     LIMIT 1`,
    [bookingId]
  );
  const row = rows?.[0];
  if (!row) {
    return { result: 'Not yet submitted', result_description: '', updated_by: null };
  }

  let updatedBy = null;
  if (Number(row.updated_by) === 0) {
    const [adminRows] = await pool.query(
      `SELECT CONCAT(admin_fristname, ' ', admin_lastname) AS admin_name
       FROM admin WHERE admin_id = ? LIMIT 1`,
      [row.updated_by_id]
    );
    updatedBy = adminRows?.[0]?.admin_name || 'Admin';
  } else {
    const [insRows] = await pool.query(
      `SELECT CONCAT(fname, ' ', lname) AS ins_name FROM itineraries WHERE id = ? LIMIT 1`,
      [row.updated_by]
    );
    updatedBy = insRows?.[0]?.ins_name || 'Instructor';
  }

  return {
    result: row.result_option || '',
    result_description: row.result_description || '',
    updated_by: updatedBy,
  };
}

async function loadPromo(pool, booking) {
  if (Number(booking.is_promo_applied) !== 1 || Number(booking.promo_code_id) <= 0) {
    return null;
  }
  const [rows] = await pool.query(
    'SELECT promo_code, promo_description FROM promos WHERE id = ? LIMIT 1',
    [booking.promo_code_id]
  );
  const promo = rows?.[0];
  if (!promo) return null;
  return {
    promo_code: promo.promo_code,
    promo_description: promo.promo_description,
  };
}

async function resolveBookingMadeBy(pool, booking) {
  if (booking.type_of_book === 'r') return 'Customer on RideTo Site';
  if (booking.type_of_book === 'o') return 'Customer Online';
  if (Number(booking.booking_made_by_id) > 0) {
    const [rows] = await pool.query(
      `SELECT CONCAT(admin_fristname, ' ', admin_lastname) AS admin_name
       FROM admin WHERE admin_id = ? LIMIT 1`,
      [booking.booking_made_by_id]
    );
    return rows?.[0]?.admin_name || 'Admin';
  }
  return 'Admin';
}

function canEditBooking(booking) {
  return Number(booking.status) === 1 && Number(booking.refundable) === 0;
}

function resolveCustomerName(booking) {
  if (!Number(booking.user_id)) {
    return 'Admin';
  }
  const name = `${trim(booking.first_name)} ${trim(booking.sur_name)}`.trim();
  return name || 'Customer';
}

function buildBookingPayload(booking, dates, extras = {}) {
  const paymentReceived =
    Number(booking.total_amount || 0) - Number(booking.payment_due || 0);
  const dateEntries = Object.entries(dates).map(([dateKey, timeRange], index) => ({
    day_number: index + 1,
    date_key: dateKey,
    date_label: dateKey === 'TBC' ? 'TBC' : formatLongDate(dateKey),
    time_label: formatTimeAmPm(timeRange),
    is_tbc: dateKey === 'TBC',
  }));
  const firstDateKey = Object.keys(dates).find((k) => k !== 'TBC') || null;

  return {
    booking_id: Number(booking.id),
    attendee_id: Number(booking.attendee_id),
    booking_ref: booking.booking_ref || '',
    event_id: Number(booking.course_event_id),
    course_id: Number(booking.course_id),
    status: Number(booking.status),
    refundable: Number(booking.refundable),
    can_edit: canEditBooking(booking),
    type_of_book: booking.type_of_book,
    type_of_book_label: TOB_LABELS[booking.type_of_book] || booking.type_of_book,
    customer_name: resolveCustomerName(booking),
    booking_made_by_label: extras.booking_made_by_label || '',
    booking_created: booking.booking_created,
    booking_created_label: formatDateTimeLabel(booking.booking_created),
    course_cost: Number(booking.total_amount) || 0,
    payment_received: paymentReceived,
    payment_due: Number(booking.payment_due) || 0,
    total_fees: Number(booking.total_fees) || 0,
    promo: extras.promo || null,
    update_history: extras.update_history || [],
    student_result: extras.student_result || null,
    event: {
      course_name: booking.course_name || '',
      franchise_name: booking.franchise_name || '',
      location_lines: buildLocationLines(booking),
      date_entries: dateEntries,
      is_multi_day: dateEntries.filter((d) => !d.is_tbc).length > 1,
      first_date_key: firstDateKey,
      school_one_off_price: Number(booking.school_one_off_price) || 0,
      school_deposit_price: Number(booking.school_deposit_price) || 0,
      school_total_price: Number(booking.school_total_price) || 0,
      own_one_off_price: Number(booking.own_one_off_price) || 0,
      own_deposit_price: Number(booking.own_deposit_price) || 0,
      own_total_price: Number(booking.own_total_price) || 0,
    },
    attendee: {
      first_name: booking.first_name || '',
      sur_name: booking.sur_name || '',
      contact1: booking.contact1 || '',
      contact2: booking.contact2 || '',
      date_of_birth: formatDateOfBirthDisplay(booking.date_of_birth),
      email: booking.email || '',
      vehicle_type: booking.vehicle_type,
      vehicle_type_label:
        VEHICLE_TYPE_LABELS[booking.vehicle_type] ||
        VEHICLE_TYPE_LABELS[String(booking.vehicle_type)] ||
        '',
      license_type: booking.license_type,
      license_number: booking.license_number || '',
      theory_number: booking.theory_number || '',
      admin_notes: booking.admin_notes || '',
      notes: booking.notes || '',
    },
    booking_summary: [
      booking.course_abb,
      booking.loc_abb,
      firstDateKey
        ? new Date(`${firstDateKey}T12:00:00`).toLocaleDateString('en-GB')
        : '',
      formatCurrency(paymentReceived),
      TOB_LABELS[booking.type_of_book] || booking.type_of_book,
    ]
      .filter(Boolean)
      .join(' '),
  };
}

async function getBookingView(pool, idParam) {
  const attendee = await resolveBookingAttendee(pool, idParam);
  if (!attendee) {
    const deletedId = await findDeletedBookingRedirect(pool, idParam);
    if (deletedId) {
      const err = new Error('Booking was deleted');
      err.status = 404;
      err.code = 'DELETED_BOOKING';
      err.deleted_booking_id = deletedId;
      throw err;
    }
    const err = new Error('Booking/Gift Voucher not found to view');
    err.status = 404;
    throw err;
  }

  const booking = await loadBookingCore(pool, attendee.booking_id);
  if (!booking) {
    const err = new Error('Invalid Booking, Try again');
    err.status = 404;
    throw err;
  }

  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date ASC`,
    [booking.course_event_id]
  );
  const dates = buildEventDatesMap(dateRows);

  const [updateHistory, studentResult, promo, bookingMadeBy] = await Promise.all([
    loadUpdateHistory(pool, booking.id),
    loadStudentResult(pool, booking.id),
    loadPromo(pool, booking),
    resolveBookingMadeBy(pool, booking),
  ]);

  return buildBookingPayload(booking, dates, {
    update_history: updateHistory,
    student_result: studentResult,
    promo,
    booking_made_by_label: bookingMadeBy,
  });
}

async function getEditBookingForm(pool, idParam, { newEventId } = {}) {
  const view = await getBookingView(pool, idParam);
  if (!view.can_edit) {
    const err = new Error('This booking cannot be edited');
    err.status = 400;
    throw err;
  }

  const booking = await loadBookingCore(pool, view.booking_id);
  const targetEventId = newEventId
    ? Number(newEventId)
    : Number(booking.course_event_id);

  const [eventRows] = await pool.query(
    `SELECT course_events.*, courses.course_name, courses.cancel_price,
            locations.location_name
     FROM course_events
     JOIN courses ON courses.id = course_events.course_id
     LEFT JOIN locations ON locations.id = course_events.location_id
     WHERE course_events.id = ? LIMIT 1`,
    [targetEventId]
  );
  const targetEvent = eventRows?.[0];
  if (!targetEvent) {
    const err = new Error('Invalid course event');
    err.status = 404;
    throw err;
  }

  const currentVehicleType = Number(booking.vehicle_type);
  const nvTypes = getVehicleTypeOptions(targetEvent, currentVehicleType, true);
  const vtypeTrue = nvTypes.some((o) => o.value === currentVehicleType);

  const [dateRows] = await pool.query(
    `SELECT event_date, event_start_time, event_end_time
     FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date ASC`,
    [targetEventId]
  );
  const dates = buildEventDatesMap(dateRows);
  const dateEntries = Object.entries(dates).map(([dateKey, timeRange], index) => ({
    day_number: index + 1,
    date_key: dateKey,
    date_label: dateKey === 'TBC' ? 'TBC' : formatLongDate(dateKey),
    time_label: formatTimeAmPm(timeRange),
    is_tbc: dateKey === 'TBC',
  }));

  const manualAvail =
    Number(targetEvent.vehicle_type_manual || 0) -
    Number(targetEvent.manual_lock_done || 0);
  const autoAvail =
    Number(targetEvent.vehicle_type_automatic || 0) -
    Number(targetEvent.automatic_lock_done || 0);

  const moveToEvents = await getMoveToEvents(
    pool,
    booking.course_id,
    booking.course_event_id
  );
  const licenceTypes = await getLicenceTypes(pool);

  return {
    ...view,
    edit: {
      new_event_id: newEventId ? Number(newEventId) : null,
      target_event_id: targetEventId,
      move_to_events: moveToEvents,
      vehicle_type_options: getVehicleTypeOptions(
        targetEvent,
        currentVehicleType,
        vtypeTrue
      ),
      manual_available: manualAvail,
      automatic_available: autoAvail,
      licence_types: licenceTypes,
      cancel_price: Number(targetEvent.cancel_price || booking.cancel_price) || 0,
      target_event: {
        course_name: targetEvent.course_name || view.event.course_name,
        location_name: targetEvent.location_name || '',
        date_entries: dateEntries,
        is_multi_day: dateEntries.filter((d) => !d.is_tbc).length > 1,
      },
      vehicle_type_warning: !vtypeTrue && newEventId,
    },
  };
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

async function chkUserByEmail(pool, email) {
  const [rows] = await pool.query(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [trim(email)]
  );
  return rows?.[0]?.id || 0;
}

async function insertNewUser(pool, attendee) {
  const [result] = await pool.query(
    `INSERT INTO users (first_name, sur_name, email, contact1, contact2, date_of_birth, created, modified)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      titleCase(attendee.first_name),
      titleCase(attendee.sur_name),
      trim(attendee.email),
      trim(attendee.contact1).replace(/\s/g, ''),
      trim(attendee.contact2).replace(/\s/g, ''),
      parseDateOfBirth(attendee.date_of_birth) || null,
    ]
  );
  return result.insertId;
}

async function syncContactCard(pool, attendeeId, body) {
  const [attendeeRows] = await pool.query(
    'SELECT contact_card_id FROM booking_attendees WHERE id = ? LIMIT 1',
    [attendeeId]
  );
  const contactCardId = attendeeRows?.[0]?.contact_card_id;
  if (!contactCardId) return;

  const dob = parseDateOfBirth(body.date_of_birth) || null;
  await pool.query(
    `UPDATE booking_attendees_dropdown
     SET contact1 = ?, contact2 = ?, date_of_birth = ?, email = ?,
         license_number = ?, theory_number = ?, first_name = ?, sur_name = ?
     WHERE id = ?`,
    [
      trim(body.contact1).replace(/\s/g, ''),
      trim(body.contact2).replace(/\s/g, ''),
      dob,
      trim(body.email),
      trim(body.license_number).toUpperCase(),
      trim(body.theory_number),
      titleCase(body.first_name),
      titleCase(body.sur_name),
      contactCardId,
    ]
  );
}

async function lessEditedBooking(pool, eventId, spaces = 1) {
  const [parentRows] = await pool.query(
    'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
    [eventId]
  );
  const parent = parentRows?.[0]?.parent;
  if (parent == null) return;
  await pool.query(
    'UPDATE course_events SET bookings_done = bookings_done - ? WHERE parent = ?',
    [spaces, parent]
  );
}

async function addEditBookingsDone(pool, eventId, spaces = 1) {
  const [parentRows] = await pool.query(
    'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
    [eventId]
  );
  const parent = parentRows?.[0]?.parent;
  if (parent == null) return;
  await pool.query(
    'UPDATE course_events SET bookings_done = bookings_done + ? WHERE parent = ?',
    [spaces, parent]
  );
}

async function saveMoveBooking(pool, book, curEventId) {
  const [insertResult] = await pool.query(
    `INSERT INTO bookings
      (course_id, course_event_id, user_id, booking_made_by_id, booking_made_by,
       type_of_book, spaces, payment_due, total_fees, vatrate, vat, total_amount,
       status, lockid, created, modified, admin_payment_received,
       edited_booking_id, edit_payment_type)
     VALUES (?, ?, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, 0, ?, NOW(), ?, ?, 'none')`,
    [
      book.course_id,
      book.course_event_id,
      book.booking_made_by_id,
      book.booking_made_by,
      book.type_of_book,
      book.payment_due,
      book.total_fees,
      book.vatrate || 0,
      book.vat || 0,
      book.total_amount,
      book.created,
      book.admin_payment_received,
      book.edited_booking_id,
    ]
  );
  const newId = insertResult.insertId;
  await addEditBookingsDone(pool, book.course_event_id, 1);
  await lessEditedBooking(pool, curEventId, 1);
  await pool.query('UPDATE bookings SET status = 5 WHERE id = ?', [
    book.edited_booking_id,
  ]);
  await pool.query('UPDATE booking_payments SET booking_id = ? WHERE booking_id = ?', [
    newId,
    book.edited_booking_id,
  ]);
  return newId;
}

async function saveEditBooking(pool, bookingId, book) {
  await pool.query(
    `UPDATE bookings
     SET payment_due = ?, total_fees = ?, vatrate = ?, vat = ?, total_amount = ?,
         status = ?, modified = NOW(), admin_payment_received = ?, edit_payment_type = ?
     WHERE id = ?`,
    [
      book.payment_due,
      book.total_fees,
      book.vatrate || 0,
      book.vat || 0,
      book.total_amount,
      book.status,
      book.admin_payment_received,
      book.edit_payment_type || 'admin_adj',
      bookingId,
    ]
  );
}

async function updateBooking(pool, idParam, body, adminId, session) {
  const view = await getBookingView(pool, idParam);
  if (!view.can_edit) {
    const err = new Error('This booking cannot be edited');
    err.status = 400;
    throw err;
  }

  const booking = await loadBookingCore(pool, view.booking_id);
  const attendeeId = Number(body.edit_attendee_id || body.attendee_id || booking.attendee_id);
  const currentVehicleType = Number(booking.vehicle_type);
  const newVehicleType = Number(body.vehicle_type);
  const newEventId = body.new_event_id ? Number(body.new_event_id) : 0;

  const blackData = await checkBlacklisted(pool, body.license_number);
  if (blackData) {
    if (session) {
      session.blacklisted = { status: 1, data: { 0: blackData } };
    }
    const err = new Error(
      'There has been a problem with your booking. Please contact our office for more information.'
    );
    err.status = 400;
    err.code = 'BLACKLISTED';
    throw err;
  }

  const [targetEventRows] = await pool.query(
    'SELECT * FROM course_events WHERE id = ? LIMIT 1',
    [newEventId || booking.course_event_id]
  );
  const targetEvent = targetEventRows?.[0];
  if (!targetEvent) {
    const err = new Error('Invalid course event');
    err.status = 404;
    throw err;
  }

  const manualAvail =
    Number(targetEvent.vehicle_type_manual || 0) -
    Number(targetEvent.manual_lock_done || 0);
  const autoAvail =
    Number(targetEvent.vehicle_type_automatic || 0) -
    Number(targetEvent.automatic_lock_done || 0);

  if (newVehicleType === 0 && manualAvail < 1 && newVehicleType !== currentVehicleType) {
    const err = new Error(
      'Number of desired(Manual) vehicles are not available. Please try another option'
    );
    err.status = 400;
    throw err;
  }
  if (newVehicleType === 1 && autoAvail < 1 && newVehicleType !== currentVehicleType) {
    const err = new Error(
      'Number of desired(Automatic) vehicles are not available. Please try another option'
    );
    err.status = 400;
    throw err;
  }

  const courseCost = Number(body.course_cost ?? booking.total_amount) || 0;
  const paymentReceived =
    Number(body.payment_received ?? view.payment_received) || 0;
  const amountOutstanding = Math.max(0, courseCost - paymentReceived);

  const isFrozen = await isEventFrozen(pool, booking.course_event_id);
  const vehicleChanged = newVehicleType !== currentVehicleType;
  const isMove =
    newEventId > 0 && newEventId !== Number(booking.course_event_id);

  if (currentVehicleType !== 3 && (vehicleChanged || isMove)) {
    let decField =
      currentVehicleType === 0
        ? 'manual_lock_done = manual_lock_done - 1'
        : 'automatic_lock_done = automatic_lock_done - 1';
    if (isFrozen) {
      decField += ', bookings_done = bookings_done - 1';
      const [parentRows] = await pool.query(
        'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
        [booking.course_event_id]
      );
      const parent = parentRows?.[0]?.parent;
      if (parent != null) {
        await pool.query(`UPDATE freeze SET ${decField} WHERE parent = ?`, [
          parent,
        ]);
      }
    }
    const [parentRows] = await pool.query(
      'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
      [booking.course_event_id]
    );
    const parent = parentRows?.[0]?.parent;
    if (parent != null) {
      await pool.query(`UPDATE course_events SET ${decField} WHERE parent = ?`, [
        parent,
      ]);
    }
  }

  if (newVehicleType !== 3 && (vehicleChanged || isMove)) {
    const incField =
      newVehicleType === 0
        ? 'manual_lock_done = manual_lock_done + 1'
        : 'automatic_lock_done = automatic_lock_done + 1';
    const incEventId = isMove ? newEventId : booking.course_event_id;
    const [parentRows] = await pool.query(
      'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
      [incEventId]
    );
    const parent = parentRows?.[0]?.parent;
    if (parent != null) {
      await pool.query(`UPDATE course_events SET ${incField} WHERE parent = ?`, [
        parent,
      ]);
    }
  }

  const dob = parseDateOfBirth(body.date_of_birth) || null;
  await pool.query(
    `UPDATE booking_attendees
     SET first_name = ?, sur_name = ?, contact1 = ?, contact2 = ?, date_of_birth = ?,
         email = ?, vehicle_type = ?, license_type = ?, license_number = ?,
         theory_number = ?, admin_notes = ?, notes = ?
     WHERE id = ?`,
    [
      titleCase(body.first_name),
      titleCase(body.sur_name),
      trim(body.contact1).replace(/\s/g, ''),
      trim(body.contact2).replace(/\s/g, ''),
      dob,
      trim(body.email),
      newVehicleType,
      body.license_type,
      trim(body.license_number).toUpperCase(),
      trim(body.theory_number),
      body.admin_notes ?? booking.admin_notes,
      body.notes ?? booking.notes,
      attendeeId,
    ]
  );

  if (Number(body.sync_contact_card ?? 1) === 1) {
    await syncContactCard(pool, attendeeId, body);
  }

  if (trim(body.email)) {
    let userId = await chkUserByEmail(pool, body.email);
    if (!userId) {
      userId = await insertNewUser(pool, body);
    }
    await pool.query('UPDATE bookings SET user_id = ? WHERE id = ?', [
      userId,
      booking.id,
    ]);
  }

  let resultBookingId = booking.id;

  if (newEventId && newEventId !== Number(booking.course_event_id)) {
    const limit = Number(targetEvent.booking_limit) || 0;
    const done = Number(targetEvent.bookings_done) || 0;
    const locks = Number(targetEvent.current_locks) || 0;
    if (limit <= done + locks) {
      const err = new Error('No space available on this moved location');
      err.status = 400;
      throw err;
    }

    const oldPaid = Number(booking.total_amount) - Number(booking.payment_due);
    if (
      courseCost !== Number(booking.total_amount) ||
      paymentReceived !== oldPaid
    ) {
      await pool.query(
        `INSERT INTO booking_update_history
          (booking_id, updated_by_admin_id, type, status, created, modified)
         VALUES (?, ?, 'price_updated', 'Price updated', NOW(), NOW())`,
        [attendeeId, adminId]
      );
    }

    const movedBook = {
      course_id: booking.course_id,
      course_event_id: newEventId,
      booking_made_by_id: booking.booking_made_by_id,
      booking_made_by: booking.booking_made_by,
      type_of_book: booking.type_of_book,
      payment_due: amountOutstanding,
      total_fees: courseCost,
      vatrate: 0,
      vat: 0,
      total_amount: courseCost,
      created: booking.booking_created,
      admin_payment_received: paymentReceived,
      edited_booking_id: booking.id,
    };
    resultBookingId = await saveMoveBooking(
      pool,
      movedBook,
      booking.course_event_id
    );

    await pool.query(
      'UPDATE booking_attendees SET admin_notes = ?, notes = ?, booking_id = ? WHERE id = ?',
      [body.admin_notes ?? '', body.notes ?? '', resultBookingId, attendeeId]
    );

    await pool.query(
      'UPDATE booking_update_history SET booking_id = ?, modified = NOW() WHERE booking_id = ?',
      [resultBookingId, booking.id]
    );
    await pool.query(
      `INSERT INTO booking_update_history
        (booking_id, updated_by_admin_id, type, status, created, modified)
       VALUES (?, ?, 'moved', ?, NOW(), NOW())`,
      [
        resultBookingId,
        adminId,
        `Booking moved from ${view.event.first_date_key || 'previous date'} to new event ${newEventId}`,
      ]
    );
  } else {
    const oldPaid = Number(booking.total_amount) - Number(booking.payment_due);
    if (courseCost !== Number(booking.total_amount) || paymentReceived !== oldPaid) {
      await pool.query(
        `INSERT INTO booking_update_history
          (booking_id, updated_by_admin_id, type, status, created, modified)
         VALUES (?, ?, 'price_updated', 'Price updated', NOW(), NOW())`,
        [attendeeId, adminId]
      );
    }
    await saveEditBooking(pool, booking.id, {
      payment_due: amountOutstanding,
      total_fees: courseCost,
      vatrate: 0,
      vat: 0,
      total_amount: courseCost,
      status: 1,
      admin_payment_received: paymentReceived,
      edit_payment_type: 'admin_adj',
    });
  }

  if (body.resend_confirmation) {
    await sendAdminBookingConfirmationEmail(pool, resultBookingId, {
      resendMode: Number(body.resend_confirmation),
    });
  }
  if (body.resend_confirmation_email) {
    await sendAdminBookingConfirmationEmail(pool, resultBookingId, {
      overrideEmail: trim(body.resend_confirmation_email),
    });
  }

  return {
    booking_id: resultBookingId,
    redirect_url: `/admin/bookings/${resultBookingId}`,
    message: newEventId
      ? 'Booking moved successfully'
      : 'User details updated successfully',
  };
}

module.exports = {
  getBookingView,
  getEditBookingForm,
  updateBooking,
  resolveBookingAttendee,
};
