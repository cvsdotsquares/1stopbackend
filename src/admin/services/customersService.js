const crypto = require('crypto');
const { phpUnserialize } = require('../../utils/phpSerialize');

const RECORDS_PER_PAGE = 10;
const MEMBERS_PER_PAGE = 1000;

const VEHICLE_TYPE_LABELS = {
  0: 'Manual',
  1: 'Automatic',
  3: 'I will be using my own vehicle',
};

const CAKEPHP_SALT = 'DYhG93b0qyJuIp4kjlN8ltP9lj0wvniR2G0FgaC9mi';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function titleCase(value) {
  return trim(value)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function cakephp210Password(password) {
  return crypto
    .createHash('sha1')
    .update(CAKEPHP_SALT + password)
    .digest('hex');
}

function parseDateOfBirth(value) {
  const raw = trim(value);
  if (!raw) return null;
  // dd/mm/yyyy or yyyy-mm-dd
  const uk = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (uk) {
    const [, d, m, y] = uk;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const swapped = raw.replace(/\//g, '-');
  const t = Date.parse(swapped);
  if (!Number.isNaN(t)) {
    const dt = new Date(t);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function formatDateOfBirthDisplay(value) {
  if (value == null || value === '' || value === '0000-00-00') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = String(value.getDate()).padStart(2, '0');
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const y = value.getFullYear();
    return `${d}/${m}/${y}`;
  }
  const s = String(value);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s;
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

function paginationMeta(page, perPage, total) {
  const pageNum = Math.max(1, Number(page) || 1);
  return {
    page: pageNum,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

async function getLicenceTypes(pool) {
  const [rows] = await pool.query(
    'SELECT id, licence_type FROM driving_licence_types WHERE status = 1 ORDER BY id ASC'
  );
  return (rows || []).map((r) => ({
    value: Number(r.id),
    label: r.licence_type,
  }));
}

function vehicleTypeLabel(value) {
  if (value == null || value === '') return '';
  const key = String(value);
  return VEHICLE_TYPE_LABELS[key] || VEHICLE_TYPE_LABELS[Number(value)] || '';
}

function mapContactCard(row, licenceTypes = []) {
  if (!row) return null;
  const licence =
    licenceTypes.find((lt) => Number(lt.value) === Number(row.license_type)) ||
    null;
  return {
    id: Number(row.id),
    booking_id: row.booking_id,
    booking_ref: row.booking_ref || '',
    first_name: row.first_name || '',
    sur_name: row.sur_name || '',
    full_name: `${trim(row.first_name)} ${trim(row.sur_name)}`.trim(),
    contact1: row.contact1 || '',
    contact2: row.contact2 || '',
    contact3: row.contact3 || '',
    email: row.email || '',
    date_of_birth: formatDateOfBirthDisplay(row.date_of_birth),
    date_of_birth_raw: row.date_of_birth,
    vehicle_type:
      row.vehicle_type == null || row.vehicle_type === ''
        ? ''
        : Number(row.vehicle_type),
    vehicle_type_label: vehicleTypeLabel(row.vehicle_type),
    license_type:
      row.license_type == null || row.license_type === ''
        ? ''
        : Number(row.license_type),
    license_type_label: licence?.label || '',
    license_number: row.license_number || '',
    theory_number: row.theory_number || '',
    notes: row.notes || '',
    is_blacklisted: Number(row.is_blacklisted) || 0,
    created: row.created,
  };
}

function buildContactSearchWhere(searchterm, { blacklistedOnly = false } = {}) {
  let where = " WHERE booking_attendees_dropdown.id != '' ";
  const params = [];

  if (blacklistedOnly) {
    where += ' AND booking_attendees_dropdown.is_blacklisted = 1 ';
  }

  const nameScr = trim(searchterm?.name_scr);
  if (nameScr) {
    const like = `%${nameScr}%`;
    where += ` AND (
      booking_attendees_dropdown.booking_ref LIKE ?
      OR booking_attendees_dropdown.first_name LIKE ?
      OR booking_attendees_dropdown.sur_name LIKE ?
      OR booking_attendees_dropdown.email LIKE ?
      OR booking_attendees_dropdown.contact1 LIKE ?
      OR booking_attendees_dropdown.contact2 LIKE ?
      OR booking_attendees_dropdown.contact3 LIKE ?
      OR booking_attendees_dropdown.license_number LIKE ?
      OR CONCAT(booking_attendees_dropdown.first_name, ' ', booking_attendees_dropdown.sur_name) LIKE ?
    )`;
    params.push(like, like, like, like, like, like, like, like, like);
  }

  return { where, params };
}

async function listContactCards(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const { where, params } = buildContactSearchWhere(searchterm);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;
  const licenceTypes = await getLicenceTypes(pool);

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM booking_attendees_dropdown ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM booking_attendees_dropdown ${where}
     ORDER BY booking_attendees_dropdown.id DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  return {
    items: (rows || []).map((row) => mapContactCard(row, licenceTypes)),
    pagination: paginationMeta(pageNum, RECORDS_PER_PAGE, total),
    filters: { name_scr: trim(searchterm?.name_scr) },
    options: {
      vehicle_types: Object.entries(VEHICLE_TYPE_LABELS).map(([value, label]) => ({
        value: Number(value),
        label,
      })),
      licence_types: licenceTypes,
    },
  };
}

async function getContactCardById(pool, id) {
  const cardId = Number(id);
  if (!Number.isFinite(cardId) || cardId <= 0) return null;
  const licenceTypes = await getLicenceTypes(pool);
  const [rows] = await pool.query(
    'SELECT * FROM booking_attendees_dropdown WHERE id = ? LIMIT 1',
    [cardId]
  );
  const mapped = mapContactCard(rows?.[0], licenceTypes);
  if (!mapped) return null;
  return {
    ...mapped,
    options: {
      vehicle_types: Object.entries(VEHICLE_TYPE_LABELS).map(([value, label]) => ({
        value: Number(value),
        label,
      })),
      licence_types: licenceTypes,
    },
  };
}

function normalizeContactPayload(body) {
  return {
    first_name: titleCase(body.first_name),
    sur_name: titleCase(body.sur_name),
    email: trim(body.email),
    contact1: trim(body.contact1).replace(/\s/g, ''),
    contact2: trim(body.contact2).replace(/\s/g, ''),
    contact3: trim(body.contact3).replace(/\s/g, ''),
    date_of_birth: parseDateOfBirth(body.date_of_birth),
    vehicle_type:
      body.vehicle_type === '' || body.vehicle_type == null
        ? null
        : Number(body.vehicle_type),
    license_type:
      body.license_type === '' || body.license_type == null
        ? null
        : Number(body.license_type),
    license_number: trim(body.license_number).toUpperCase().slice(0, 16),
    theory_number: trim(body.theory_number),
    notes: trim(body.notes),
  };
}

function validateContactPayload(data, { requireName = true } = {}) {
  if (requireName && !data.first_name) {
    return 'First name is required';
  }
  if (data.license_number && data.license_number.length > 16) {
    return 'Licence number must be 16 characters or fewer';
  }
  return null;
}

async function createContactCard(pool, body) {
  const data = normalizeContactPayload(body || {});
  const err = validateContactPayload(data);
  if (err) return { ok: false, message: err };

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const [result] = await pool.query(
    `INSERT INTO booking_attendees_dropdown
      (first_name, sur_name, contact1, contact2, contact3, date_of_birth, email,
       vehicle_type, license_type, license_number, theory_number, notes, created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.first_name,
      data.sur_name,
      data.contact1,
      data.contact2,
      data.contact3,
      data.date_of_birth,
      data.email,
      data.vehicle_type,
      data.license_type,
      data.license_number,
      data.theory_number,
      data.notes,
      now,
    ]
  );

  return {
    ok: true,
    message: 'Contact card added successfully',
    data: { id: result.insertId },
  };
}

async function updateContactCard(pool, id, body) {
  const cardId = Number(id);
  if (!Number.isFinite(cardId) || cardId <= 0) {
    return { ok: false, message: 'Contact card not found to edit' };
  }

  const existing = await getContactCardById(pool, cardId);
  if (!existing) {
    return { ok: false, message: 'Contact card not found to edit' };
  }

  const data = normalizeContactPayload(body || {});
  const err = validateContactPayload(data);
  if (err) return { ok: false, message: err };

  await pool.query(
    `UPDATE booking_attendees_dropdown
     SET first_name = ?, sur_name = ?, contact1 = ?, contact2 = ?, contact3 = ?,
         date_of_birth = ?, email = ?, vehicle_type = ?, license_type = ?,
         license_number = ?, theory_number = ?, notes = ?
     WHERE id = ?`,
    [
      data.first_name,
      data.sur_name,
      data.contact1,
      data.contact2,
      data.contact3,
      data.date_of_birth,
      data.email,
      data.vehicle_type,
      data.license_type,
      data.license_number,
      data.theory_number,
      data.notes,
      cardId,
    ]
  );

  return { ok: true, message: 'Contact card updated successfully' };
}

async function deleteContactCard(pool, id) {
  const cardId = Number(id);
  if (!Number.isFinite(cardId) || cardId <= 0) {
    return { ok: false, message: 'Contact card not found to delete' };
  }
  const [result] = await pool.query(
    'DELETE FROM booking_attendees_dropdown WHERE id = ?',
    [cardId]
  );
  if (!result.affectedRows) {
    return { ok: false, message: 'Contact card not found to delete' };
  }
  return { ok: true, message: 'Contact card deleted successfully' };
}

async function listBlacklisted(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const { where, params } = buildContactSearchWhere(searchterm, {
    blacklistedOnly: true,
  });
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;
  const licenceTypes = await getLicenceTypes(pool);

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM booking_attendees_dropdown ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM booking_attendees_dropdown ${where}
     ORDER BY booking_attendees_dropdown.id DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  return {
    items: (rows || []).map((row) => mapContactCard(row, licenceTypes)),
    pagination: paginationMeta(pageNum, RECORDS_PER_PAGE, total),
    filters: { name_scr: trim(searchterm?.name_scr) },
  };
}

async function fetchLicenceDetails(pool, licenceNo) {
  const license = trim(licenceNo).toUpperCase();
  if (!license) {
    return { ok: false, message: 'Please enter a licence number' };
  }

  const [rows] = await pool.query(
    `SELECT * FROM booking_attendees_dropdown
     WHERE license_number = ? LIMIT 1`,
    [license]
  );
  const row = rows?.[0];
  if (!row) {
    return {
      ok: false,
      message: 'No contact card found for this licence number',
    };
  }
  if (Number(row.is_blacklisted) === 1) {
    return {
      ok: false,
      message: 'This client is already blacklisted',
    };
  }

  const licenceTypes = await getLicenceTypes(pool);
  const mapped = mapContactCard(row, licenceTypes);
  return {
    ok: true,
    data: {
      id: mapped.id,
      full_name: mapped.full_name,
      contact_no: mapped.contact1 || mapped.contact2 || '',
      email: mapped.email,
      license_number: mapped.license_number,
      notes: mapped.notes,
    },
  };
}

async function setContactBlacklist(pool, id, { blacklisted = true, notes = '' } = {}) {
  const cardId = Number(id);
  if (!Number.isFinite(cardId) || cardId <= 0) {
    return { ok: false, message: 'Contact card not found' };
  }

  const [rows] = await pool.query(
    'SELECT id, is_blacklisted, notes FROM booking_attendees_dropdown WHERE id = ? LIMIT 1',
    [cardId]
  );
  if (!rows?.[0]) {
    return { ok: false, message: 'Contact card not found' };
  }

  if (blacklisted) {
    const noteText = trim(notes);
    const storedNotes = noteText
      ? noteText.replace(/\n/g, '<br />')
      : rows[0].notes || '';
    await pool.query(
      `UPDATE booking_attendees_dropdown
       SET is_blacklisted = 1, notes = ?
       WHERE id = ?`,
      [storedNotes, cardId]
    );
    return { ok: true, message: 'Client marked as blacklisted' };
  }

  await pool.query(
    `UPDATE booking_attendees_dropdown
     SET is_blacklisted = 0
     WHERE id = ?`,
    [cardId]
  );
  return { ok: true, message: 'Client removed from blacklist' };
}

function safeUnserializeBookingData(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  const str = String(raw);
  try {
    const parsed = phpUnserialize(str);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // fall through
  }
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function extractDeletedRow(dbRow) {
  const snapshot = safeUnserializeBookingData(dbRow.booking_data) || {};
  const booking = snapshot.booking || {};
  const attendee = snapshot.attendee || {};
  const courseInfo = snapshot.course_info || {};

  // Legacy PHP only renders rows that have both attendee.id and booking.id
  // (unpaid cleanup often archives empty attendee stubs — those are skipped).
  const attendeeId = Number(attendee.id) || 0;
  const bookingId = Number(booking.id) || Number(dbRow.booking_id) || 0;
  const displayable = Boolean(attendeeId && bookingId);

  const firstName = attendee.first_name || '';
  const surName = attendee.sur_name || '';
  const hasCourseInfo =
    courseInfo &&
    typeof courseInfo === 'object' &&
    Object.keys(courseInfo).length > 0;

  const courseAbb = hasCourseInfo
    ? courseInfo.course_abb || courseInfo.course_name || ''
    : '';
  const courseDateRaw = hasCourseInfo
    ? courseInfo.event_date || courseInfo.course_date || null
    : null;

  return {
    id: Number(dbRow.id),
    attendee_id: attendeeId,
    booking_id: bookingId,
    booking_ref:
      attendee.booking_ref || dbRow.booking_ref || booking.booking_ref || '',
    attendee_name: `${trim(firstName)} ${trim(surName)}`.trim() || '—',
    first_name: firstName,
    sur_name: surName,
    course_abb: courseAbb,
    course_date: formatUkDate(courseDateRaw),
    result: 'Not yet submitted',
    license_number: attendee.license_number || '',
    email: attendee.email || '',
    contact1: attendee.contact1 || '',
    contact2: attendee.contact2 || '',
    contact3: attendee.contact3 || '',
    displayable,
    needs_course_fallback: displayable && !hasCourseInfo,
    _course_id: Number(booking.course_id) || 0,
    _course_event_id: Number(booking.course_event_id) || 0,
  };
}

async function enrichDeletedListRow(pool, row) {
  let courseAbb = row.course_abb;
  let courseDate = row.course_date;

  if (row.needs_course_fallback) {
    if (row._course_id > 0) {
      const [courseRows] = await pool.query(
        'SELECT course_abb FROM courses WHERE id = ? LIMIT 1',
        [row._course_id]
      );
      courseAbb = courseRows?.[0]?.course_abb || '';
    }
    if (row._course_event_id > 0) {
      const [dateRows] = await pool.query(
        `SELECT event_date
         FROM course_event_dates
         WHERE course_event_id = ?
         ORDER BY event_date ASC
         LIMIT 1`,
        [row._course_event_id]
      );
      courseDate = formatUkDate(dateRows?.[0]?.event_date || null);
    }
  }

  let result = 'Not yet submitted';
  if (row.booking_id > 0) {
    const [resultRows] = await pool.query(
      `SELECT iro.\`option\` AS result_option
       FROM student_daily_report sdr
       INNER JOIN itinary_result_options iro ON iro.id = sdr.report
       WHERE sdr.booking_id = ?
       LIMIT 1`,
      [row.booking_id]
    );
    if (resultRows?.[0]?.result_option) {
      result = resultRows[0].result_option;
    }
  }

  return {
    id: row.id,
    booking_id: row.booking_id,
    booking_ref: row.booking_ref,
    attendee_name: row.attendee_name,
    first_name: row.first_name,
    sur_name: row.sur_name,
    course_abb: courseAbb,
    course_date: courseDate,
    result,
    license_number: row.license_number,
    email: row.email,
    contact1: row.contact1,
    contact2: row.contact2,
    contact3: row.contact3,
  };
}

async function listDeletedBookings(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const nameScr = trim(searchterm?.name_scr);
  let where = ' WHERE 1=1 ';
  const params = [];

  if (nameScr) {
    const like = `%${nameScr}%`;
    // Match legacy: search booking_data blob (and also booking_ref for convenience)
    where +=
      ' AND (deleted_bookings.booking_ref LIKE ? OR deleted_bookings.booking_data LIKE ?)';
    params.push(like, like);
  }

  // Pagination counts all archive rows (including incomplete stubs), same as PHP.
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM deleted_bookings ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const [rows] = await pool.query(
    `SELECT * FROM deleted_bookings ${where}
     ORDER BY deleted_bookings.created DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  const extracted = (rows || []).map(extractDeletedRow);
  const items = [];
  for (const row of extracted) {
    if (!row.displayable) continue;
    items.push(await enrichDeletedListRow(pool, row));
  }

  return {
    items,
    pagination: paginationMeta(pageNum, RECORDS_PER_PAGE, total),
    filters: { name_scr: nameScr },
  };
}

async function purgeDeletedBooking(pool, id) {
  const rowId = Number(id);
  if (!Number.isFinite(rowId) || rowId <= 0) {
    return { ok: false, message: 'Deleted booking not found' };
  }

  const [rows] = await pool.query(
    'SELECT * FROM deleted_bookings WHERE id = ? LIMIT 1',
    [rowId]
  );
  const row = rows?.[0];
  if (!row) {
    return { ok: false, message: 'Deleted booking not found' };
  }

  const bookingId = Number(row.booking_id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (bookingId > 0) {
      await connection.query(
        'DELETE FROM booking_payments WHERE booking_id = ?',
        [bookingId]
      );
      await connection.query(
        'DELETE FROM student_daily_report WHERE booking_id = ?',
        [bookingId]
      );
    }
    await connection.query('DELETE FROM deleted_bookings WHERE id = ?', [rowId]);
    await connection.commit();
    return { ok: true, message: 'Deleted booking permanently removed' };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function listAttendingCustomers(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const nameScr = trim(searchterm?.name_scr);
  let where = ` WHERE bookings.status IN (1, 2) `;
  const params = [];

  if (nameScr) {
    const like = `%${nameScr}%`;
    // booking_ref lives on booking_attendees (not bookings)
    where += ` AND (
      booking_attendees.booking_ref LIKE ?
      OR booking_attendees.first_name LIKE ?
      OR booking_attendees.sur_name LIKE ?
      OR booking_attendees.email LIKE ?
      OR booking_attendees.contact1 = ?
      OR booking_attendees.contact2 = ?
      OR booking_attendees.contact3 = ?
      OR CONCAT(booking_attendees.first_name, ' ', booking_attendees.sur_name) LIKE ?
    )`;
    params.push(like, like, like, like, nameScr, nameScr, nameScr, like);
  }

  const fromJoin = `
    FROM booking_attendees
    INNER JOIN bookings ON bookings.id = booking_attendees.booking_id
    LEFT JOIN courses ON courses.id = bookings.course_id
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
        booking_attendees.id AS attendee_id,
        booking_attendees.booking_id,
        booking_attendees.booking_ref,
        booking_attendees.first_name,
        booking_attendees.sur_name,
        booking_attendees.email,
        booking_attendees.contact1,
        booking_attendees.contact2,
        booking_attendees.contact3,
        booking_attendees.license_number,
        courses.course_abb,
        course_event_dates.event_date AS course_date
     ${fromJoin}
     ${where}
     ORDER BY booking_attendees.id DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  const items = [];
  for (const row of rows || []) {
    let resultLabel = 'Not yet submitted';
    try {
      const [resultRows] = await pool.query(
        `SELECT itinary_result_options.\`option\` AS result_label
         FROM student_daily_report
         LEFT JOIN itinary_result_options
           ON itinary_result_options.id = student_daily_report.result
         WHERE student_daily_report.booking_id = ?
         ORDER BY student_daily_report.id DESC
         LIMIT 1`,
        [row.booking_id]
      );
      if (resultRows?.[0]?.result_label) {
        resultLabel = resultRows[0].result_label;
      }
    } catch {
      // optional tables may be missing in some envs
    }

    items.push({
      attendee_id: Number(row.attendee_id),
      booking_id: Number(row.booking_id),
      booking_ref: row.booking_ref || '',
      attendee_name: `${trim(row.first_name)} ${trim(row.sur_name)}`.trim(),
      course_abb: row.course_abb || '',
      course_date: formatUkDate(row.course_date),
      result: resultLabel,
      license_number: row.license_number || '',
      email: row.email || '',
      contact1: row.contact1 || '',
      contact2: row.contact2 || '',
      contact3: row.contact3 || '',
    });
  }

  return {
    items,
    pagination: paginationMeta(pageNum, RECORDS_PER_PAGE, total),
    filters: { name_scr: nameScr },
  };
}

function mapMember(row) {
  if (!row) return null;
  const regType = trim(row.reg_type || row.user_type || '');
  return {
    id: Number(row.id),
    first_name: row.first_name || '',
    sur_name: row.sur_name || '',
    full_name: `${trim(row.first_name)} ${trim(row.sur_name)}`.trim(),
    email: row.email || '',
    add1: row.add1 || '',
    add2: row.add2 || '',
    add3: row.add3 || '',
    postcode: row.postcode || '',
    contact1: row.contact1 || '',
    contact2: row.contact2 || '',
    date_of_birth: formatDateOfBirthDisplay(row.date_of_birth),
    reg_type: regType,
    reg_type_label:
      regType === 'g' || regType.toLowerCase() === 'guest' ? 'Guest' : 'Member',
    status: Number(row.status) || 0,
    status_label: Number(row.status) === 1 ? 'Active' : 'De-active',
    created: row.created,
  };
}

async function listMembers(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const nameScr = trim(searchterm?.name_scr);
  const statusScr = trim(searchterm?.status_scr);
  let where = " WHERE users.id != '' ";
  const params = [];

  if (statusScr === '1' || statusScr === '0') {
    where += ' AND users.status = ? ';
    params.push(Number(statusScr));
  }

  if (nameScr) {
    const lower = nameScr.toLowerCase();
    if (lower === 'guest') {
      where += " AND users.reg_type = 'g' ";
    } else if (lower === 'member') {
      where +=
        " AND (users.reg_type IS NULL OR users.reg_type = '' OR users.reg_type != 'g') ";
    } else {
      const like = `%${nameScr}%`;
      where += ` AND (
        users.first_name LIKE ?
        OR users.sur_name LIKE ?
        OR users.email LIKE ?
        OR users.add1 LIKE ?
        OR users.add2 LIKE ?
        OR users.add3 LIKE ?
        OR users.postcode LIKE ?
        OR users.contact1 LIKE ?
        OR users.contact2 LIKE ?
        OR CONCAT(users.first_name, ' ', users.sur_name) LIKE ?
      )`;
      params.push(like, like, like, like, like, like, like, like, like, like);
    }
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM users ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;
  const offset = (pageNum - 1) * MEMBERS_PER_PAGE;

  const [rows] = await pool.query(
    `SELECT * FROM users ${where} ORDER BY users.id DESC LIMIT ?, ?`,
    [...params, offset, MEMBERS_PER_PAGE]
  );

  return {
    items: (rows || []).map(mapMember),
    pagination: paginationMeta(pageNum, MEMBERS_PER_PAGE, total),
    filters: {
      name_scr: nameScr,
      status_scr: statusScr,
    },
  };
}

async function getMemberById(pool, id) {
  const memberId = Number(id);
  if (!Number.isFinite(memberId) || memberId <= 0) return null;
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [
    memberId,
  ]);
  return mapMember(rows?.[0]);
}

async function updateMember(pool, id, body) {
  const memberId = Number(id);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return { ok: false, message: 'Member not found to edit' };
  }

  const existing = await getMemberById(pool, memberId);
  if (!existing) {
    return { ok: false, message: 'Member not found to edit' };
  }

  const firstName = titleCase(body?.first_name);
  const email = trim(body?.email);
  if (!firstName) return { ok: false, message: 'First name is required' };
  if (!email) return { ok: false, message: 'Email is required' };

  const [dup] = await pool.query(
    'SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1',
    [email, memberId]
  );
  if (dup?.[0]) {
    return { ok: false, message: 'Email already exists' };
  }

  const password = trim(body?.password);
  const fields = [
    firstName,
    titleCase(body?.sur_name),
    email,
    trim(body?.add1),
    trim(body?.add2),
    trim(body?.add3),
    trim(body?.postcode),
    trim(body?.contact1),
    trim(body?.contact2),
    parseDateOfBirth(body?.date_of_birth),
  ];

  let sql = `UPDATE users SET
    first_name = ?, sur_name = ?, email = ?,
    add1 = ?, add2 = ?, add3 = ?, postcode = ?,
    contact1 = ?, contact2 = ?, date_of_birth = ?`;

  if (password) {
    sql += ', password = ?';
    fields.push(cakephp210Password(password));
  }

  sql += ' WHERE id = ?';
  fields.push(memberId);

  await pool.query(sql, fields);
  return { ok: true, message: 'Member updated successfully' };
}

async function listMemberBookings(pool, id) {
  const memberId = Number(id);
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return { ok: false, message: 'Member not found' };
  }

  const [rows] = await pool.query(
    `SELECT bookings.id,
            COALESCE(booking_attendees.booking_ref, CONCAT('1SRC', bookings.id)) AS booking_ref,
            bookings.status,
            bookings.created,
            courses.course_abb,
            courses.course_name
     FROM bookings
     LEFT JOIN booking_attendees
       ON booking_attendees.booking_id = bookings.id
      AND booking_attendees.\`primary\` = 1
     LEFT JOIN courses ON courses.id = bookings.course_id
     WHERE bookings.user_id = ?
     ORDER BY bookings.id DESC`,
    [memberId]
  );

  return {
    ok: true,
    data: {
      items: (rows || []).map((row) => ({
        id: Number(row.id),
        booking_ref: row.booking_ref || '',
        status: Number(row.status),
        course_abb: row.course_abb || '',
        course_name: row.course_name || '',
        created: row.created,
      })),
    },
  };
}

module.exports = {
  listContactCards,
  getContactCardById,
  createContactCard,
  updateContactCard,
  deleteContactCard,
  listBlacklisted,
  fetchLicenceDetails,
  setContactBlacklist,
  listDeletedBookings,
  purgeDeletedBooking,
  listAttendingCustomers,
  listMembers,
  getMemberById,
  updateMember,
  listMemberBookings,
  VEHICLE_TYPE_LABELS,
};
