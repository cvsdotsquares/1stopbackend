const {
  getEvent,
  timeAmPm,
  buildEventDates,
} = require('./bookingDetailsService');
const { updateApiEventCourse } = require('./bookingApiAdminService');
const { sendAdminBookingMail } = require('./adminBookingMailService');

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

function formatDateDDMMYYYY(dateValue) {
  if (!dateValue) return '';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateLongWithTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  const day = d.getDate();
  const suffix =
    day > 3 && day < 21
      ? 'th'
      : ['th', 'st', 'nd', 'rd'][day % 10 > 3 ? 0 : day % 10] || 'th';
  const time = d.toLocaleTimeString('en-GB', { hour12: false });
  return `${weekday} ${day}${suffix} ${month} ${d.getFullYear()} ${time}`;
}

function formatHistoryDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-GB');
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} @ ${time}`;
}

function currencyFormatted(amt) {
  const value = Number(amt);
  const safe = Number.isFinite(value) ? value : 0;
  return `£${safe.toFixed(2)}`;
}

function typeofBookingLabels() {
  return {
    m: 'Moto',
    o: 'Online',
    t: 'Terminal',
    w: 'Worldpay',
    r: 'RideTo',
  };
}

function vTypeSelectLabels() {
  return {
    '0': 'Manual',
    '1': 'Automatic',
    '3': 'I will be using my own vehicle',
  };
}

function formatAddress4Slug(slug) {
  const map = {
    '1-stop-instruction-ilford': 'Ilford (Fairlop Powerleague)',
    '1-stop-instruction-beckton': 'Beckton (Newham Powerleague)',
    '1-stop-instruction-barnet': 'Barnet',
    '1-stop-instruction-tottenham': 'Tottenham (Frederick Knight Sports Ground)',
  };
  return map[slug] || slug;
}

function buildLocationLines(location) {
  const address4 = location.address4
    ? formatAddress4Slug(location.address4)
    : '';
  return [
    location.location_name,
    location.address1,
    location.address2,
    location.address3,
    address4,
    location.postcode,
  ].filter(Boolean);
}

function parseDobInput(value) {
  const raw = trim(value);
  if (!raw || raw === '0000-00-00') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = raw.split(/[/-]/);
  if (parts.length === 3) {
    const [d, m, y] = parts;
    if (y.length === 4) {
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateValue(parsed);
  }
  return '';
}

function ucWordsName(value) {
  return trim(value)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

async function getFranchiseRefVariants(pool, idParam) {
  const [rows] = await pool.query(
    `SELECT inv_prefix FROM franchise
     WHERE inv_prefix != '' AND inv_prefix != '1SRC'`
  );
  const refs = [
    idParam,
    `1SRC${idParam}`,
    ...rows.map((r) => `${r.inv_prefix}${idParam}`),
  ];
  return [...new Set(refs)];
}

async function resolveBookingAttendee(pool, idParam) {
  const key = trim(idParam);
  if (!key) {
    return null;
  }

  const refVariants = await getFranchiseRefVariants(pool, key);
  const refPlaceholders = refVariants.map(() => '?').join(', ');
  const params = [key, ...refVariants];

  const [rows] = await pool.query(
    `SELECT booking_attendees.*, bookings.course_event_id, bookings.status
     FROM booking_attendees
     LEFT JOIN bookings ON booking_attendees.booking_id = bookings.id
     WHERE CAST(booking_attendees.booking_id AS CHAR) = ?
        OR booking_attendees.booking_ref IN (${refPlaceholders})
     ORDER BY booking_attendees.\`primary\` DESC
     LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function findDeletedBooking(pool, idParam) {
  const key = trim(idParam);
  const [rows] = await pool.query(
    `SELECT booking_id FROM deleted_bookings
     WHERE booking_id = ? OR booking_ref LIKE ?
     ORDER BY id ASC
     LIMIT 1`,
    [key, `%${key}%`]
  );
  return rows[0] || null;
}

async function loadConfirmedBooking(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT *, bookings.created AS bcreated
     FROM bookings
     JOIN course_events ON course_events.id = bookings.course_event_id
     JOIN courses ON courses.id = bookings.course_id
     JOIN locations ON locations.id = course_events.location_id
     JOIN franchise ON franchise.id = course_events.franchise_id
     JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     WHERE bookings.id = ?
     LIMIT 1`,
    [Number(bookingId)]
  );
  return rows[0] || null;
}

async function loadEditableBooking(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT courses.cancel_price, bookings.*, booking_attendees.*,
      booking_attendees.id AS bkId, bookings.id AS bid,
      users.first_name AS ufn, users.sur_name AS usn
     FROM bookings
     LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     JOIN courses ON courses.id = bookings.course_id
     LEFT JOIN users ON users.id = bookings.user_id
     WHERE bookings.status = 1 AND bookings.id = ?
     LIMIT 1`,
    [Number(bookingId)]
  );
  return rows[0] || null;
}

async function isFrozen(pool, courseEventId) {
  const [rows] = await pool.query(
    'SELECT id FROM freeze WHERE course_event_id = ? LIMIT 1',
    [Number(courseEventId)]
  );
  return rows.length > 0;
}

async function isEventFrozen(pool, courseEventId) {
  const [rows] = await pool.query(
    'SELECT COUNT(id) AS total FROM freeze WHERE course_event_id = ?',
    [Number(courseEventId)]
  );
  return Number(rows[0]?.total) > 0;
}

async function getMoveToEvents(pool, courseId, currentEventId) {
  const [rows] = await pool.query(
    `SELECT * FROM (
      SELECT locations.location_name, locations.id AS location_id,
        course_event_dates.course_event_id,
        MIN(course_event_dates.event_date) AS event_date,
        course_event_dates.event_start_time, course_event_dates.event_end_time,
        course_events.event_type, course_events.booking_limit,
        course_events.bookings_done, course_events.current_locks,
        courses.course_name, courses.id AS course_id
      FROM course_event_dates
      JOIN course_events ON course_events.id = course_event_dates.course_event_id
      JOIN courses ON courses.id = course_events.course_id
      JOIN locations ON locations.id = course_events.location_id
      WHERE course_events.status = '1'
        AND courses.status IN ('1', '2')
        AND course_event_dates.event_date != '0000-00-00'
        AND (course_events.booking_limit > (course_events.bookings_done + course_events.current_locks))
        AND courses.id = ?
      GROUP BY course_event_id
      ORDER BY course_event_dates.course_event_id, course_event_dates.event_date,
        locations.location_name, course_event_dates.event_start_time
    ) sq
    GROUP BY sq.course_event_id
    ORDER BY sq.event_date ASC, sq.location_name ASC, sq.event_start_time ASC`,
    [Number(courseId)]
  );

  const today = formatDateValue(new Date());
  const events = [];
  const order = [];

  for (const evt of rows || []) {
    if (await isEventFrozen(pool, evt.course_event_id)) {
      continue;
    }
    const eventDate = formatDateValue(evt.event_date);
    if (
      Number(evt.booking_limit) > Number(evt.bookings_done) + Number(evt.current_locks) &&
      eventDate >= today &&
      Number(evt.course_event_id) !== Number(currentEventId)
    ) {
      const start = String(evt.event_start_time || '').slice(0, 5);
      const end = String(evt.event_end_time || '').slice(0, 5);
      const formatTime = (t) => {
        const [h, m] = t.split(':').map(Number);
        const suffix = h >= 12 ? 'pm' : 'am';
        const hour = h % 12 === 0 ? 12 : h % 12;
        return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
      };
      events.push({
        course_event_id: Number(evt.course_event_id),
        event_date: eventDate,
        location_name: evt.location_name,
        timings: `${formatTime(start)} - ${formatTime(end)}`,
        label: `${new Date(`${eventDate}T12:00:00`).toLocaleDateString('en-GB', {
          weekday: 'short',
          month: 'long',
          day: '2-digit',
          year: 'numeric',
        })}-----------------${evt.location_name}-----------------${formatTime(start)} - ${formatTime(end)}`,
      });
      order.push(events.length - 1);
    }
  }

  return { events, order };
}

function editBookingOneOffPrice(ce, newEventId, bookData, cutCrs, post = {}) {
  let movingMsg = '';
  let adminFee = 0;
  let cancleOutDate = formatDateValue(new Date());
  let courseFee = Number(bookData.total_amount) || 0;

  if (newEventId) {
    adminFee = Number(bookData.cancel_price) || 0;
    const dateKeys = Object.keys(cutCrs.dates || {}).filter((k) => k !== 'TBC');
    const currentCourseDate = dateKeys.sort()[0] || '';
    const currentCancelDays = Number(cutCrs.cancel_days) || 0;
    cancleOutDate = formatDateValue(
      new Date(
        new Date(`${currentCourseDate}T12:00:00`).getTime() -
          (currentCancelDays + 1) * 86400000
      )
    );
    if (formatDateValue(new Date()) > cancleOutDate) {
      adminFee = 0;
    }
    courseFee = Number(ce.school_one_off_price || ce.own_one_off_price) || 0;

    movingMsg = '<div class="col-lg-12 warningText">';
    if (formatDateValue(new Date()) > cancleOutDate) {
      movingMsg +=
        `You are trying to move or edit a course within the specified cancellation period.  If you proceed with moving this course you will not receive a refund for this date and be charged £${courseFee.toFixed(2)}   This is the figure which should be charged if Pay fee via MOTO is selected.`;
    } else {
      const diff = courseFee - (Number(bookData.total_amount) - Number(bookData.payment_due));
      movingMsg += `You will be charged an admin fee of £${adminFee.toFixed(2)} to move this course + a course fee difference of £${diff.toFixed(2)} The total of these figures is the figure which should be charged if Pay fee via MOTO is selected..... at the moment MOTO payment requests the price of the new course rather than just admin fee`;
    }
    movingMsg += '</div>';
  }

  let courseCost = 0;
  if (post.course_cost != null && post.course_cost !== '') {
    courseCost = Number(post.course_cost) + adminFee;
  } else {
    courseCost = courseFee + adminFee;
  }

  let paymentRece = 0;
  if (formatDateValue(new Date()) > cancleOutDate) {
    paymentRece = 0;
  } else {
    paymentRece = Number(bookData.total_amount) - Number(bookData.payment_due);
  }

  let paymentOuts = 0;
  if (formatDateValue(new Date()) > cancleOutDate) {
    if (post.amount_outstanding != null && post.amount_outstanding !== '') {
      paymentOuts = Number(post.course_cost) - Number(post.payment_received) + adminFee;
    } else {
      paymentOuts = courseFee;
    }
  } else if (post.amount_outstanding != null && post.amount_outstanding !== '') {
    paymentOuts = Number(post.course_cost) - Number(post.payment_received) + adminFee;
  } else {
    paymentOuts =
      courseFee - (Number(bookData.total_amount) - Number(bookData.payment_due)) + adminFee;
  }

  if (paymentOuts < 0) {
    movingMsg += `<br>Please contact the admin to arrange a refund for the difference in course fee £${Math.abs(paymentOuts).toFixed(2)}`;
  }

  return {
    movingMsg,
    course_cost: courseCost,
    payment_rece: paymentRece,
    payment_outs: paymentOuts,
  };
}

function computeVehicleAvailability(ce, currentVehicleType, vtypeTrue, manCountOld = 0, autoCountOld = 0) {
  const manualAvail =
    Number(ce.vehicle_type_manual) - Number(ce.manual_lock_done) + manCountOld;
  const autoAvail =
    Number(ce.vehicle_type_automatic) - Number(ce.automatic_lock_done) + autoCountOld;

  const vTypeSelect = {};
  if (
    (Number(ce.vehicle_type_automatic) > 0 &&
      Number(ce.vehicle_type_automatic) > Number(ce.automatic_lock_done) - autoCountOld) ||
    (String(currentVehicleType) === '1' && vtypeTrue)
  ) {
    vTypeSelect['1'] = 'Automatic';
  }
  if (
    (Number(ce.vehicle_type_manual) > 0 &&
      Number(ce.vehicle_type_manual) > Number(ce.manual_lock_done) - manCountOld) ||
    (String(currentVehicleType) === '0' && vtypeTrue)
  ) {
    vTypeSelect['0'] = 'Manual';
  }
  if (Number(ce.vehicle_type_own) === 1) {
    vTypeSelect['3'] = 'I will be using my own vehicle';
  }

  return { manualAvail, autoAvail, vTypeSelect };
}

function checkNewEventVehicleType(ce, oldVehicleType, manCountOld = 0, autoCountOld = 0) {
  const nvTypes = {};
  if (
    Number(ce.vehicle_type_automatic) > 0 &&
    Number(ce.vehicle_type_automatic) > Number(ce.automatic_lock_done) - autoCountOld
  ) {
    nvTypes['1'] = 'Automatic';
  }
  if (
    Number(ce.vehicle_type_manual) > 0 &&
    Number(ce.vehicle_type_manual) > Number(ce.manual_lock_done) - manCountOld
  ) {
    nvTypes['0'] = 'Manual';
  }
  if (Number(ce.vehicle_type_own) === 1) {
    nvTypes['3'] = 'I will be using my own vehicle';
  }
  return Object.prototype.hasOwnProperty.call(nvTypes, String(oldVehicleType));
}

async function getMatchedPriorBookings(pool, bData) {
  const matchFields = {};
  if (trim(bData.contact1)) matchFields.contact1 = bData.contact1;
  if (trim(bData.contact2)) matchFields.contact2 = bData.contact2;
  if (trim(bData.contact3)) matchFields.contact3 = bData.contact3;
  if (trim(bData.email)) matchFields.email = bData.email;
  if (trim(bData.license_number)) matchFields.license_number = bData.license_number;

  if (!Object.keys(matchFields).length) {
    return [];
  }

  const clauses = Object.keys(matchFields).map((key) => `\`${key}\` = ?`);
  const values = Object.values(matchFields);
  const [rows] = await pool.query(
    `SELECT booking_attendees.*, bookings.id AS booking_id, bookings.status
     FROM booking_attendees
     LEFT JOIN bookings ON booking_attendees.booking_id = bookings.id
     WHERE bookings.status = 1
       AND booking_attendees.created < ?
       AND (${clauses.join(' OR ')})`,
    [bData.created, ...values]
  );
  return rows || [];
}

async function getItineraryResult(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT student_daily_report.*, itinary_result_options.option
     FROM student_daily_report
     JOIN itinary_result_options ON itinary_result_options.id = student_daily_report.report
     WHERE student_daily_report.booking_id = ?
     LIMIT 1`,
    [Number(bookingId)]
  );
  const row = rows[0];
  if (!row) {
    return null;
  }

  let updatedByName = '';
  if (Number(row.updated_by) === 0) {
    const [adminRows] = await pool.query(
      `SELECT CONCAT(admin_fristname, ' ', admin_lastname) AS admin_name
       FROM admin WHERE admin_id = ? LIMIT 1`,
      [row.updated_by_id]
    );
    updatedByName = adminRows[0]?.admin_name || '';
  } else {
    const [insRows] = await pool.query(
      `SELECT CONCAT(fname, ' ', lname) AS ins_name FROM itineraries WHERE id = ? LIMIT 1`,
      [row.updated_by]
    );
    updatedByName = insRows[0]?.ins_name || '';
  }

  return {
    option: row.option,
    result_description: row.result_description || '',
    updated_by_name: updatedByName,
  };
}

async function getBookingMadeByLabel(pool, bData) {
  if (bData.type_of_book === 'r') {
    return 'Customer on RideTo Site';
  }
  if (bData.type_of_book !== 'o') {
    const [rows] = await pool.query(
      `SELECT CONCAT(admin_fristname, ' ', admin_lastname) AS admin_name
       FROM admin WHERE admin_id = ? LIMIT 1`,
      [bData.booking_made_by_id]
    );
    return rows[0]?.admin_name || '';
  }
  return 'Customer Online';
}

async function getUpdateHistory(pool, bookingId) {
  const [rows] = await pool.query(
    `SELECT booking_update_history.*,
      CONCAT(admin.admin_fristname, ' ', admin.admin_lastname) AS admin_name
     FROM booking_update_history
     LEFT JOIN admin ON admin.admin_id = booking_update_history.updated_by_admin_id
     WHERE booking_update_history.booking_id = ?
     ORDER BY booking_update_history.created DESC`,
    [Number(bookingId)]
  );
  return (rows || []).map((row) => ({
    status: row.status,
    type: row.type,
    admin_name: row.admin_name || '',
    created: row.created,
    label: `${row.status} by ${row.admin_name || ''} on ${formatHistoryDate(row.created)}`,
  }));
}

async function checkBlacklisted(pool, licenseNumber) {
  const licence = trim(licenseNumber);
  if (!licence) return null;
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

async function insertNewUser(pool, post) {
  const now = formatTimestamp();
  const [result] = await pool.query(
    `INSERT INTO users (first_name, sur_name, email, contact1, contact2, contact3, reg_type, status, created, modified)
     VALUES (?, ?, ?, ?, ?, ?, 'g', 1, ?, ?)`,
    [
      ucWordsName(post.first_name),
      ucWordsName(post.sur_name),
      trim(post.email),
      trim(post.contact1).replace(/\s/g, ''),
      trim(post.contact2).replace(/\s/g, ''),
      trim(post.contact3 || '').replace(/\s/g, ''),
      now,
      now,
    ]
  );
  return result.insertId;
}

async function editBookingSaveAttendee(pool, post, nbid) {
  const dateOfBirth = parseDobInput(post.date_of_birth);
  await pool.query(
    `UPDATE booking_attendees SET first_name = ?, sur_name = ?, contact1 = ?, contact2 = ?,
      date_of_birth = ?, email = ?, vehicle_type = ?, license_type = ?, license_number = ?,
      theory_number = ?, admin_notes = ?, notes = ?
     WHERE id = ?`,
    [
      ucWordsName(post.first_name),
      ucWordsName(post.sur_name),
      trim(post.contact1).replace(/\s/g, ''),
      trim(post.contact2).replace(/\s/g, ''),
      dateOfBirth || null,
      trim(post.email),
      post.vehicle_type,
      post.license_type,
      trim(post.license_number).toUpperCase(),
      post.theory_number,
      post.admin_notes,
      post.notes,
      Number(post.edit_attendee_form || post.edit_attendee),
    ]
  );

  if (trim(post.license_number)) {
    const licence = trim(post.license_number).toUpperCase();
    const [recCheck] = await pool.query(
      'SELECT id FROM booking_attendees_dropdown WHERE license_number = ? LIMIT 1',
      [licence]
    );
    if (!recCheck[0]) {
      const [rec] = await pool.query(
        'SELECT * FROM booking_attendees WHERE license_number = ? ORDER BY id DESC LIMIT 1',
        [licence]
      );
      if (rec[0]) {
        await pool.query(
          `UPDATE booking_attendees_dropdown SET license_number = ?
           WHERE LCASE(first_name) = ? AND LCASE(sur_name) = ? AND LCASE(email) = ?
             AND LCASE(contact1) = ? AND LCASE(contact2) = ? AND LCASE(date_of_birth) = ?`,
          [
            licence,
            trim(post.first_name).toLowerCase(),
            trim(post.sur_name).toLowerCase(),
            trim(post.email).toLowerCase(),
            trim(post.contact1).replace(/\s/g, '').toLowerCase(),
            trim(post.contact2).replace(/\s/g, '').toLowerCase(),
            dateOfBirth,
          ]
        );
      }
    }
  }

  if (trim(post.email)) {
    let uid = await chkUserByEmail(pool, post.email);
    if (!uid) {
      uid = await insertNewUser(pool, post);
    }
    await pool.query('UPDATE bookings SET user_id = ? WHERE id = ?', [uid, Number(nbid)]);
  }
}

async function editBookingSaveAttendeeNew(pool, post, nbid) {
  const dateOfBirth = parseDobInput(post.date_of_birth);
  const attendeeId = Number(post.edit_attendee_form || post.edit_attendee);

  await pool.query(
    `UPDATE booking_attendees SET first_name = ?, sur_name = ?, contact1 = ?, contact2 = ?,
      date_of_birth = ?, email = ?, vehicle_type = ?, license_type = ?, license_number = ?,
      theory_number = ?, admin_notes = ?, notes = ?
     WHERE id = ?`,
    [
      ucWordsName(post.first_name),
      ucWordsName(post.sur_name),
      trim(post.contact1).replace(/\s/g, ''),
      trim(post.contact2).replace(/\s/g, ''),
      dateOfBirth || null,
      trim(post.email),
      post.vehicle_type,
      post.license_type,
      trim(post.license_number).toUpperCase(),
      post.theory_number,
      post.admin_notes,
      post.notes,
      attendeeId,
    ]
  );

  const [recRows] = await pool.query(
    'SELECT * FROM booking_attendees WHERE booking_id = ? ORDER BY id DESC LIMIT 1',
    [Number(nbid)]
  );
  const rec = recRows[0];
  if (rec?.contact_card_id) {
    const [rec1Rows] = await pool.query(
      'SELECT * FROM booking_attendees_dropdown WHERE id = ? LIMIT 1',
      [rec.contact_card_id]
    );
    const rec1 = rec1Rows[0];
    if (rec1) {
      const licence = trim(post.license_number).toUpperCase();
      if (licence) {
        if (licence === String(rec1.license_number || '').toUpperCase()) {
          await pool.query(
            `UPDATE booking_attendees_dropdown SET contact1 = ?, contact2 = ?, date_of_birth = ?,
              email = ?, license_number = ?, theory_number = ?, first_name = ?, sur_name = ?
             WHERE id = ?`,
            [
              trim(post.contact1).replace(/\s/g, ''),
              trim(post.contact2).replace(/\s/g, ''),
              dateOfBirth,
              trim(post.email),
              licence,
              post.theory_number,
              ucWordsName(post.first_name),
              ucWordsName(post.sur_name),
              rec1.id,
            ]
          );
        } else {
          await pool.query(
            `UPDATE booking_attendees_dropdown SET contact1 = ?, contact2 = ?, date_of_birth = ?,
              email = ?, license_number = ?, theory_number = ?, first_name = ?, sur_name = ?
             WHERE license_number = ?`,
            [
              trim(post.contact1).replace(/\s/g, ''),
              trim(post.contact2).replace(/\s/g, ''),
              dateOfBirth,
              trim(post.email),
              licence,
              post.theory_number,
              ucWordsName(post.first_name),
              ucWordsName(post.sur_name),
              licence,
            ]
          );
        }
      } else {
        await pool.query(
          `UPDATE booking_attendees_dropdown SET contact1 = ?, contact2 = ?, date_of_birth = ?,
            email = ?, license_number = ?, theory_number = ?, first_name = ?, sur_name = ?
           WHERE id = ?`,
          [
            trim(post.contact1).replace(/\s/g, ''),
            trim(post.contact2).replace(/\s/g, ''),
            dateOfBirth,
            trim(post.email),
            licence,
            post.theory_number,
            ucWordsName(post.first_name),
            ucWordsName(post.sur_name),
            rec1.id,
          ]
        );
      }
    }
  }

  const [bookingRows] = await pool.query(
    'SELECT course_event_id FROM bookings WHERE id = ? LIMIT 1',
    [Number(nbid)]
  );
  const [eventDateRows] = await pool.query(
    'SELECT event_date FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date ASC LIMIT 1',
    [bookingRows[0]?.course_event_id]
  );
  const eventDate = eventDateRows[0]?.event_date;
  if (rec?.contact_card_id && eventDate) {
    const [futureRows] = await pool.query(
      `SELECT bookings.id AS bid, booking_attendees.id AS baid, booking_attendees.*
       FROM bookings
       LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
       LEFT JOIN course_events ON bookings.course_event_id = course_events.id
       LEFT JOIN course_event_dates ON course_event_dates.course_event_id = course_events.id
       WHERE (bookings.status != 5 OR bookings.status IS NULL)
         AND booking_attendees.contact_card_id > 0
         AND booking_attendees.contact_card_id = ?
         AND booking_attendees.id <> ?
         AND course_event_dates.event_date >= ?
       ORDER BY bookings.id DESC`,
      [rec.contact_card_id, rec.id, eventDate]
    );

    const updateIds = new Set();
    for (const row of futureRows || []) {
      if (
        trim(row.license_number) &&
        trim(row.license_number).toUpperCase() === trim(post.license_number).toUpperCase()
      ) {
        updateIds.add(row.baid);
      }
      if (trim(row.email) && trim(row.email) === trim(post.email)) {
        updateIds.add(row.baid);
      }
      if (trim(row.contact1) && trim(row.contact1) === trim(post.contact1)) {
        updateIds.add(row.baid);
      }
      if (trim(row.contact2) && trim(row.contact2) === trim(post.contact2)) {
        updateIds.add(row.baid);
      }
      if (trim(row.contact3) && trim(row.contact3) === trim(post.contact3)) {
        updateIds.add(row.baid);
      }
    }

    if (updateIds.size) {
      const ids = [...updateIds];
      const placeholders = ids.map(() => '?').join(', ');
      await pool.query(
        `UPDATE booking_attendees SET first_name = ?, sur_name = ?, contact1 = ?, contact2 = ?,
          date_of_birth = ?, email = ?, license_number = ?, theory_number = ?
         WHERE id IN (${placeholders})`,
        [
          ucWordsName(post.first_name),
          ucWordsName(post.sur_name),
          trim(post.contact1).replace(/\s/g, ''),
          trim(post.contact2).replace(/\s/g, ''),
          dateOfBirth,
          trim(post.email),
          trim(post.license_number).toUpperCase(),
          post.theory_number,
          ...ids,
        ]
      );
    }
  }

  if (trim(post.license_number)) {
    const licence = trim(post.license_number).toUpperCase();
    const [recCheck] = await pool.query(
      'SELECT id FROM booking_attendees_dropdown WHERE license_number = ? LIMIT 1',
      [licence]
    );
    if (!recCheck[0]) {
      const [licRec] = await pool.query(
        'SELECT * FROM booking_attendees WHERE license_number = ? ORDER BY id DESC LIMIT 1',
        [licence]
      );
      if (licRec[0]) {
        await pool.query(
          `UPDATE booking_attendees_dropdown SET license_number = ?
           WHERE LCASE(first_name) = ? AND LCASE(sur_name) = ? AND LCASE(email) = ?
             AND LCASE(contact1) = ? AND LCASE(contact2) = ? AND LCASE(contact3) = ?`,
          [
            licence,
            trim(post.first_name).toLowerCase(),
            trim(post.sur_name).toLowerCase(),
            trim(post.email).toLowerCase(),
            trim(post.contact1).replace(/\s/g, '').toLowerCase(),
            trim(post.contact2).replace(/\s/g, '').toLowerCase(),
            trim(post.contact3 || '').replace(/\s/g, '').toLowerCase(),
          ]
        );
      }
    }
  }

  if (trim(post.email)) {
    let uid = await chkUserByEmail(pool, post.email);
    if (!uid) {
      uid = await insertNewUser(pool, post);
    }
    await pool.query('UPDATE bookings SET user_id = ? WHERE id = ?', [uid, Number(nbid)]);
  }
}

async function decrementOldVehicleLocks(pool, oldEventId, currentVehicleType) {
  if (String(currentVehicleType) === '3') {
    return;
  }

  let chvCount;
  if (String(currentVehicleType) === '0') {
    chvCount = 'manual_lock_done = manual_lock_done - 1';
  } else {
    chvCount = 'automatic_lock_done = automatic_lock_done - 1';
  }

  const frozen = await isFrozen(pool, oldEventId);
  const [ptnRows] = await pool.query(
    'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
    [Number(oldEventId)]
  );
  const parent = ptnRows[0]?.parent;
  if (!parent) return;

  if (frozen) {
    const frozenClause =
      String(currentVehicleType) === '0'
        ? 'manual_lock_done = manual_lock_done - 1, bookings_done = bookings_done - 1'
        : 'automatic_lock_done = automatic_lock_done - 1, bookings_done = bookings_done - 1';
    await pool.query(`UPDATE freeze SET ${frozenClause} WHERE parent = ?`, [parent]);
  }

  await pool.query(`UPDATE course_events SET ${chvCount} WHERE parent = ?`, [parent]);
}

async function incrementNewVehicleLocks(pool, newEventId, vehicleType) {
  if (String(vehicleType) === '3') {
    return;
  }
  const chvCount =
    String(vehicleType) === '0'
      ? 'manual_lock_done = manual_lock_done + 1'
      : 'automatic_lock_done = automatic_lock_done + 1';
  const [ptnRows] = await pool.query(
    'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
    [Number(newEventId)]
  );
  const parent = ptnRows[0]?.parent;
  if (!parent) return;
  await pool.query(`UPDATE course_events SET ${chvCount} WHERE parent = ?`, [parent]);
}

async function lessEditedBooking(pool, evId) {
  const [ptnRows] = await pool.query(
    'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
    [Number(evId)]
  );
  const parent = ptnRows[0]?.parent;
  if (!parent) return;
  await pool.query(
    'UPDATE course_events SET bookings_done = GREATEST(0, bookings_done - 1) WHERE parent = ?',
    [parent]
  );
}

async function addEditBookingsDone(pool, evId) {
  const [ptnRows] = await pool.query(
    'SELECT parent FROM course_events WHERE id = ? LIMIT 1',
    [Number(evId)]
  );
  const parent = ptnRows[0]?.parent;
  if (!parent) return;
  await pool.query(
    'UPDATE course_events SET bookings_done = bookings_done + 1 WHERE parent = ?',
    [parent]
  );
}

async function changeBookingStatus(pool, bookingId, status) {
  await pool.query('UPDATE bookings SET status = ? WHERE id = ?', [status, Number(bookingId)]);
}

async function saveMoveBooking(pool, book, curEventId) {
  const vatrate = await getVatRate(pool);
  book.vatrate = vatrate;

  const [ceRows] = await pool.query(
    `SELECT course_events.*, courses.dsa_fees
     FROM course_events
     JOIN courses ON courses.id = course_events.course_id
     WHERE course_events.id = ?
     LIMIT 1`,
    [Number(book.course_event_id)]
  );
  const ce = ceRows[0];
  if (ce?.vat === 1 && vatrate > 0 && book.total_amount) {
    const rate = (100 + vatrate) / 100;
    const vatFee =
      Number(book.total_amount) >= Number(ce.dsa_fees)
        ? Number(book.total_amount) - Number(ce.dsa_fees)
        : Number(book.total_amount);
    book.vat = Math.round((vatFee - vatFee / rate) * 100) / 100;
  } else {
    book.vat = book.vat || 0;
  }

  const [result] = await pool.query(
    `INSERT INTO bookings (
      course_id, course_event_id, user_id, booking_made_by_id, booking_made_by, type_of_book,
      spaces, payment_due, total_fees, vatrate, vat, total_amount, status, lockid, created,
      modified, admin_payment_received, edited_booking_id, edit_payment_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      book.course_id,
      book.course_event_id,
      book.user_id,
      book.booking_made_by_id,
      book.booking_made_by,
      book.type_of_book,
      book.spaces,
      book.payment_due,
      book.total_fees,
      book.vatrate,
      book.vat,
      book.total_amount,
      book.status,
      book.lockid,
      book.created,
      book.modified,
      book.admin_payment_received,
      book.edited_booking_id,
      book.edit_payment_type,
    ]
  );

  const lastBookId = result.insertId;
  await addEditBookingsDone(pool, book.course_event_id);
  await lessEditedBooking(pool, curEventId);
  await changeBookingStatus(pool, book.edited_booking_id, 5);
  await pool.query('UPDATE booking_payments SET booking_id = ? WHERE booking_id = ?', [
    lastBookId,
    book.edited_booking_id,
  ]);

  return lastBookId;
}

async function saveEditBooking(pool, bD, ce) {
  const vatrate = await getVatRate(pool);
  const book = {
    payment_due: bD.payment_due,
    total_fees: bD.total_fees,
    total_amount: bD.total_amount,
    status: bD.status,
    modified: formatTimestamp(),
    admin_payment_received: bD.admin_payment_received,
    edit_payment_type: bD.edit_payment_type,
    vatrate: bD.vatrate,
    vat: bD.vat,
  };

  if (ce?.vat === 1 && vatrate > 0 && bD.total_amount) {
    book.vatrate = vatrate;
    const rate = (100 + vatrate) / 100;
    const vatFee =
      Number(bD.total_amount) >= Number(ce.dsa_fees)
        ? Number(bD.total_amount) - Number(ce.dsa_fees)
        : Number(bD.total_amount);
    book.vat = Math.round((vatFee - vatFee / rate) * 100) / 100;
  }

  await pool.query(
    `UPDATE bookings SET payment_due = ?, total_fees = ?, vatrate = ?, vat = ?,
      total_amount = ?, status = ?, modified = ?, admin_payment_received = ?, edit_payment_type = ?
     WHERE id = ?`,
    [
      book.payment_due,
      book.total_fees,
      book.vatrate,
      book.vat,
      book.total_amount,
      book.status,
      book.modified,
      book.admin_payment_received,
      book.edit_payment_type,
      Number(bD.edited_booking_id),
    ]
  );
}

function mapEventDatesForResponse(dates) {
  const entries = [];
  let day = 1;
  const keys = Object.keys(dates || {});
  for (const key of keys) {
    if (key === 'TBC') {
      entries.push({ day, label: `Day ${day} - TBC`, dateKey: 'TBC', time: '' });
    } else {
      const multi = keys.filter((k) => k !== 'TBC').length > 1;
      entries.push({
        day,
        dateKey: key,
        label: multi
          ? `Day ${day} - ${new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })} (${timeAmPm(dates[key])})`
          : `${new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })} (${timeAmPm(dates[key])})`,
        time: timeAmPm(dates[key]),
      });
    }
    day += 1;
  }
  return entries;
}

async function getBookingView(pool, idParam) {
  const attendee = await resolveBookingAttendee(pool, idParam);
  if (!attendee) {
    const deleted = await findDeletedBooking(pool, idParam);
    if (deleted) {
      return {
        ok: false,
        deleted: true,
        deletedBookingId: deleted.booking_id,
        message: 'Booking/Gift Voucher not found to view',
      };
    }
    return { ok: false, message: 'Booking/Gift Voucher not found to view' };
  }

  const bData = await loadConfirmedBooking(pool, attendee.booking_id);
  if (!bData) {
    return { ok: false, message: 'Booking/Gift Voucher not found to view' };
  }

  const [oriRows] = await pool.query(
    'SELECT created FROM bookings WHERE CAST(id AS CHAR) = ? LIMIT 1',
    [trim(idParam)]
  );
  const oriBookingDate = oriRows[0]?.created || bData.bcreated;

  const [dateRows] = await pool.query(
    'SELECT * FROM course_event_dates WHERE course_event_id = ? ORDER BY event_date ASC',
    [bData.course_event_id]
  );
  const eventDates = buildEventDates(dateRows);
  const dateKeys = Object.keys(eventDates).filter((k) => k !== 'TBC').sort();
  const courseSumm = dateKeys[0] || '';

  const typeLabels = typeofBookingLabels();
  const promo =
    Number(bData.is_promo_applied) === 1 && Number(bData.promo_code_id) > 0
      ? (
          await pool.query('SELECT * FROM promos WHERE id = ? LIMIT 1', [
            bData.promo_code_id,
          ])
        )[0][0]
      : null;

  const matchedPrior = await getMatchedPriorBookings(pool, bData);
  const itinerary = await getItineraryResult(pool, attendee.booking_id);
  const licenceTypes = await getLicenceTypes(pool);
  const licenceLabel =
    licenceTypes.find((lt) => Number(lt.id) === Number(bData.license_type))?.licence_type ||
    '';

  return {
    ok: true,
    data: {
      booking_id: Number(bData.id),
      course_event_id: Number(bData.course_event_id),
      booking_ref: bData.booking_ref,
      course_name: bData.course_name,
      event_dates: mapEventDatesForResponse(eventDates),
      location_lines: buildLocationLines(bData),
      franchise_name: bData.franchise_name,
      total_fees: Number(bData.total_fees),
      total_fees_formatted: currencyFormatted(bData.total_fees),
      payment_received: Number(bData.total_amount) - Number(bData.payment_due),
      payment_received_formatted: currencyFormatted(
        Number(bData.total_amount) - Number(bData.payment_due)
      ),
      payment_due: Number(bData.payment_due),
      payment_due_formatted: currencyFormatted(bData.payment_due),
      promo: promo
        ? {
            promo_code: promo.promo_code,
            promo_description: promo.promo_description,
          }
        : null,
      booking_created: formatDateLongWithTime(oriBookingDate),
      type_of_book: bData.type_of_book,
      type_of_book_label: typeLabels[bData.type_of_book] || bData.type_of_book,
      booking_made_by: await getBookingMadeByLabel(pool, bData),
      update_history: await getUpdateHistory(pool, attendee.booking_id),
      itinerary: itinerary || { option: 'Not yet submitted', result_description: '', updated_by_name: '' },
      attendee: {
        first_name: bData.first_name,
        sur_name: bData.sur_name,
        full_name: `${bData.first_name} ${bData.sur_name}`.trim(),
        contact1: bData.contact1,
        contact2: bData.contact2,
        contact3: bData.contact3,
        date_of_birth: formatDateDDMMYYYY(bData.date_of_birth),
        email: bData.email,
        vehicle_type: String(bData.vehicle_type),
        vehicle_type_label: vTypeSelectLabels()[String(bData.vehicle_type)] || '',
        license_type: bData.license_type,
        license_type_label: licenceLabel,
        license_number: bData.license_number,
        theory_number: bData.theory_number,
        admin_notes: bData.admin_notes || '',
        notes: bData.notes || '',
      },
      booking_summary: `${bData.course_abb} ${bData.loc_abb} ${formatDateDDMMYYYY(courseSumm)} - ${currencyFormatted(Number(bData.total_amount) - Number(bData.payment_due))} ${typeLabels[bData.type_of_book] || ''} on ${formatDateDDMMYYYY(bData.bcreated)}`,
      matched_prior_count: matchedPrior.length,
      status: Number(bData.status),
      refundable: Number(bData.refundable),
    },
  };
}

async function buildEditPayload(pool, bookData, session, newEventId) {
  const cutCrs = await getEvent(pool, bookData.course_event_id, session);
  let ce;
  let vtypeTrue = true;

  if (newEventId) {
    ce = await getEvent(pool, newEventId, session);
    if (!ce) {
      return { ok: false, message: 'Invalid Booking, Try again' };
    }
    vtypeTrue = checkNewEventVehicleType(ce, bookData.vehicle_type);
  } else {
    ce = await getEvent(pool, bookData.course_event_id, session);
  }

  if (!ce || !cutCrs) {
    return { ok: false, message: 'Invalid Booking, Try again' };
  }

  const { manualAvail, autoAvail, vTypeSelect } = computeVehicleAvailability(
    ce,
    bookData.vehicle_type,
    vtypeTrue
  );

  const moveToEvents = await getMoveToEvents(pool, bookData.course_id, bookData.course_event_id);
  const licenceTypes = await getLicenceTypes(pool);
  const typeLabels = typeofBookingLabels();

  const hasOneOff = Boolean(ce.school_one_off_price || ce.own_one_off_price);
  const hasDeposit = Boolean(ce.school_deposit_price);
  let pricing = null;
  if (hasOneOff) {
    pricing = editBookingOneOffPrice(ce, newEventId, bookData, cutCrs);
  }

  return {
    ok: true,
    data: {
      booking_id: Number(bookData.bid),
      attendee_id: Number(bookData.bkId),
      course_event_id: Number(bookData.course_event_id),
      course_id: Number(ce.course_id),
      cancel_price: Number(bookData.cancel_price) || 0,
      new_event_id: newEventId ? Number(newEventId) : null,
      vehicle_type_available: vtypeTrue,
      vehicle_alert:
        newEventId && !vtypeTrue
          ? 'The type of vehicle is not available for the date you are trying to move the booking to.  Please change the type of vehicle or select an alternative date'
          : null,
      course: {
        course_name: ce.course_name,
        event_dates: mapEventDatesForResponse(ce.dates),
        location_name: ce.location_name,
        franchise_name: ce.franchise_name,
        school_one_off_price: ce.school_one_off_price,
        own_one_off_price: ce.own_one_off_price,
        school_total_price: ce.school_total_price,
        own_total_price: ce.own_total_price,
        school_deposit_price: ce.school_deposit_price,
        own_deposit_price: ce.own_deposit_price,
      },
      move_to_events: moveToEvents,
      manual_avail: manualAvail,
      auto_avail: autoAvail,
      v_type_select: vTypeSelect,
      licence_types: licenceTypes,
      pricing: {
        show_payment_status: hasOneOff || hasDeposit,
        moving_msg_html: pricing?.movingMsg || '',
        course_cost: Number(bookData.total_amount),
        payment_received: Number(bookData.total_amount) - Number(bookData.payment_due),
        amount_outstanding: Number(bookData.payment_due),
      },
      booking: {
        created: formatDateLongWithTime(bookData.created),
        type_of_book_label: typeLabels[bookData.type_of_book] || bookData.type_of_book,
        customer_label: Number(bookData.user_id)
          ? `${bookData.ufn || ''} ${bookData.usn || ''}`.trim()
          : 'Admin',
        admin_notes: bookData.admin_notes || '',
        notes: bookData.notes || '',
      },
      attendee: {
        first_name: bookData.first_name || '',
        sur_name: bookData.sur_name || '',
        contact1: bookData.contact1 || '',
        contact2: bookData.contact2 || '',
        contact3: bookData.contact3 || '',
        date_of_birth: formatDateDDMMYYYY(bookData.date_of_birth),
        email: bookData.email || '',
        vehicle_type: String(bookData.vehicle_type ?? ''),
        license_type: String(bookData.license_type ?? ''),
        license_number: bookData.license_number || '',
        theory_number: bookData.theory_number || '',
      },
    },
  };
}

async function getBookingEdit(pool, bookingId, session, newEventId) {
  const bookData = await loadEditableBooking(pool, bookingId);
  if (!bookData) {
    return { ok: false, message: 'Invalid Booking, Try again' };
  }
  return buildEditPayload(pool, bookData, session, newEventId || null);
}

async function previewEditEvent(pool, bookingId, newEventId, session) {
  const bookData = await loadEditableBooking(pool, bookingId);
  if (!bookData) {
    return { ok: false, message: 'Invalid Booking, Try again' };
  }
  const ce = await getEvent(pool, newEventId, session);
  if (!ce) {
    return { ok: false, message: 'Invalid Booking, Try again' };
  }
  const vtypeTrue = checkNewEventVehicleType(ce, bookData.vehicle_type);
  const { manualAvail, autoAvail, vTypeSelect } = computeVehicleAvailability(
    ce,
    bookData.vehicle_type,
    vtypeTrue
  );
  return {
    ok: true,
    data: {
      new_event_id: Number(newEventId),
      vehicle_type_available: vtypeTrue,
      vehicle_alert: vtypeTrue
        ? null
        : 'The type of vehicle is not available for the date you are trying to move the booking to.  Please change the type of vehicle or select an alternative date',
      manual_avail: manualAvail,
      auto_avail: autoAvail,
      v_type_select: vTypeSelect,
    },
  };
}

async function updateBooking(pool, bookingId, body, adminId, session, req) {
  delete session.blacklisted;

  const bookData = await loadEditableBooking(pool, bookingId);
  if (!bookData) {
    return { ok: false, message: 'Invalid Booking, Try again' };
  }

  const blacklist = await checkBlacklisted(pool, body.license_number);
  if (blacklist) {
    session.blacklisted = { status: 1, data: { license_number: blacklist } };
    return {
      ok: false,
      blacklisted: session.blacklisted,
      message: 'The Client(s) has been blacklisted.',
    };
  }

  const newEventId = trim(body.new_event_id || body.newEventId) || '';
  const cutCrs = await getEvent(pool, bookData.course_event_id, session);
  let ce = newEventId
    ? await getEvent(pool, newEventId, session)
    : await getEvent(pool, bookData.course_event_id, session);

  if (!ce || !cutCrs) {
    return { ok: false, message: 'Invalid Booking, Try again' };
  }

  const currentVehicleType = bookData.vehicle_type;
  const vehicleType = body.vehicle_type;
  const vtypeTrue = newEventId ? checkNewEventVehicleType(ce, currentVehicleType) : true;
  const { manualAvail, autoAvail } = computeVehicleAvailability(
    ce,
    currentVehicleType,
    vtypeTrue
  );

  if (Number(ce.vehicle_type_automatic) > 0 || Number(ce.vehicle_type_manual) > 0) {
    let manCount = 0;
    let autoCount = 0;
    if (String(vehicleType) === '1') autoCount = 1;
    else if (String(vehicleType) === '0') manCount = 1;

    if (
      (manCount > 0 || autoCount > 0) &&
      (String(vehicleType) !== String(currentVehicleType) || newEventId)
    ) {
      if (manualAvail < manCount) {
        return {
          ok: false,
          message:
            'Number of desired(Manual) vehicles are not available. Please try another option',
        };
      }
      if (autoAvail < autoCount) {
        return {
          ok: false,
          message:
            'Number of desired(Automatic) vehicles are not available. Please try another option',
        };
      }
    }
  }

  if (
    String(currentVehicleType) !== '3' &&
    (String(vehicleType) !== String(currentVehicleType) || newEventId)
  ) {
    await decrementOldVehicleLocks(pool, bookData.course_event_id, currentVehicleType);
  }

  if (
    String(vehicleType) !== '3' &&
    (String(vehicleType) !== String(currentVehicleType) || newEventId)
  ) {
    await incrementNewVehicleLocks(pool, ce.ceId || ce.id, vehicleType);
  }

  const syncOrNot = String(body.syncornot) === '1' ? 1 : 0;
  const post = {
    ...body,
    edit_attendee_form: body.edit_attendee_form || body.edit_attendee || bookData.bkId,
    edit_attendee: body.edit_attendee || bookData.bkId,
  };

  if (syncOrNot === 1) {
    await editBookingSaveAttendeeNew(pool, post, bookingId);
  } else {
    await editBookingSaveAttendee(pool, post, bookingId);
  }

  const messages = ['User details updated successfully'];
  let resultBookingId = Number(bookingId);
  let primaryMessage = messages[0];

  const courseCost = Number(body.course_cost);
  const paymentReceived = Number(body.payment_received);
  const amountOutstanding = Number(body.amount_outstanding);
  const oldReceived = Number(bookData.total_amount) - Number(bookData.payment_due);
  const priceChanged =
    courseCost !== Number(bookData.total_amount) || paymentReceived !== oldReceived;

  if (newEventId) {
    const [evRows] = await pool.query('SELECT * FROM course_events WHERE id = ? LIMIT 1', [
      Number(newEventId),
    ]);
    const ev = evRows[0];
    if (
      ev &&
      Number(ev.booking_limit) <= Number(ev.bookings_done) + Number(ev.current_locks)
    ) {
      return {
        ok: true,
        bookingId: resultBookingId,
        messages,
        message: 'No space available on this moved location',
        flashType: 'error',
      };
    }

    if (priceChanged) {
      const now = formatTimestamp();
      await pool.query(
        `INSERT INTO booking_update_history
          (booking_id, updated_by_admin_id, type, status, created, modified)
         VALUES (?, ?, 'price_updated', 'Price updated', ?, ?)`,
        [bookingId, adminId, now, now]
      );
    }

    const book = {
      course_id: Number(body.course_id || bookData.course_id),
      course_event_id: Number(newEventId),
      user_id: 0,
      booking_made_by_id: bookData.booking_made_by_id,
      booking_made_by: bookData.booking_made_by,
      type_of_book: bookData.type_of_book,
      spaces: 1,
      payment_due: amountOutstanding,
      total_fees: courseCost,
      vatrate: 0,
      vat: 0,
      total_amount: courseCost,
      status: 1,
      lockid: 0,
      created: bookData.created,
      modified: bookData.modified,
      admin_payment_received: paymentReceived,
      edited_booking_id: Number(bookingId),
      edit_payment_type: 'none',
    };

    const nbid = await saveMoveBooking(pool, book, bookData.course_event_id);
    if (Number(newEventId) !== Number(bookData.course_event_id) && nbid > 0) {
      const newCEvent = await getEvent(pool, newEventId, session);
      const cutDateKeys = Object.keys(cutCrs.dates || {}).filter((k) => k !== 'TBC').sort();
      const newDateKeys = Object.keys(newCEvent.dates || {}).filter((k) => k !== 'TBC').sort();
      const now = formatTimestamp();
      await pool.query(
        'UPDATE booking_update_history SET booking_id = ?, modified = ? WHERE booking_id = ?',
        [nbid, now, bookingId]
      );
      await pool.query(
        `INSERT INTO booking_update_history
          (booking_id, updated_by_admin_id, type, status, created, modified)
         VALUES (?, ?, 'moved', ?, ?, ?)`,
        [
          nbid,
          adminId,
          `Booking moved from ${formatDateDDMMYYYY(cutDateKeys[0])} to ${formatDateDDMMYYYY(newDateKeys[0])}`,
          now,
          now,
        ]
      );
      await pool.query(
        'UPDATE booking_attendees SET admin_notes = ?, notes = ?, booking_id = ? WHERE id = ?',
        [body.admin_notes, body.notes, nbid, Number(post.edit_attendee_form)]
      );
      await updateApiEventCourse(pool, newEventId);
      resultBookingId = nbid;
      messages.push('Booking moved successfully');
      primaryMessage = 'Booking moved successfully';
    }
  } else {
    if (priceChanged) {
      const now = formatTimestamp();
      await pool.query(
        `INSERT INTO booking_update_history
          (booking_id, updated_by_admin_id, type, status, created, modified)
         VALUES (?, ?, 'price_updated', 'Price updated', ?, ?)`,
        [bookingId, adminId, now, now]
      );
    }

    await saveEditBooking(
      pool,
      {
        payment_due: amountOutstanding,
        total_fees: courseCost,
        vatrate: Number(body.vatrate) || bookData.vatrate || 0,
        vat: Number(body.vat) || bookData.vat || 0,
        total_amount: courseCost,
        status: 1,
        admin_payment_received: paymentReceived,
        edited_booking_id: Number(bookingId),
        edit_payment_type: 'admin_adj',
      },
      ce
    );
  }

  if (body.resendConf) {
    await sendAdminBookingMail(pool, resultBookingId, body.resendConf, req);
  }
  if (body.resendConfAnother && trim(body.resendConfAnotheremail)) {
    await sendAdminBookingMail(pool, resultBookingId, body.resendConfAnotheremail, req);
  }

  return {
    ok: true,
    bookingId: resultBookingId,
    messages,
    message: primaryMessage,
    flashType: 'success',
  };
}

module.exports = {
  getBookingView,
  getBookingEdit,
  previewEditEvent,
  updateBooking,
  resolveBookingAttendee,
};
