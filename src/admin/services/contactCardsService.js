const RECORDS_PER_PAGE = 10;

const DUPLICATE_LICENSE_MESSAGE =
  'Other Client Contact already exits with this licence number, Please select any other contact';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function ucWords(value) {
  return trim(value)
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function parseDateOfBirthInput(value) {
  const raw = trim(value);
  if (!raw || raw === '0000-00-00') {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  }

  const dashMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dashMatch) {
    return `${dashMatch[3]}-${dashMatch[2]}-${dashMatch[1]}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }

  return null;
}

function formatDateOfBirthForForm(value) {
  const raw = trim(value);
  if (!raw || raw === '0000-00-00') {
    return '';
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  return raw;
}

function decodeNotesForForm(value) {
  const raw = trim(value);
  if (!raw) {
    return '';
  }

  return raw
    .replace(/<\/?br\s*\/?>/gi, '\n')
    .replace(/\r/g, '')
    .replace(/&pound;/gi, '£');
}

function encodeNotesForSave(value) {
  const raw = trim(value);
  if (!raw) {
    return '';
  }

  return raw.replace(/£/g, '&pound;').replace(/\r\n/g, '\n').replace(/\n/g, '<br />');
}

function stripPhoneSpaces(value) {
  return trim(value).replace(/\s+/g, '');
}

function buildListWhere(nameScr) {
  const where = " WHERE booking_attendees_dropdown.id != '' ";
  const term = trim(nameScr);
  if (!term) {
    return { where, params: [] };
  }

  return {
    where: `${where} AND (
      booking_attendees_dropdown.booking_ref = ?
      OR booking_attendees_dropdown.first_name LIKE ?
      OR booking_attendees_dropdown.sur_name LIKE ?
      OR booking_attendees_dropdown.email LIKE ?
      OR booking_attendees_dropdown.contact1 = ?
      OR booking_attendees_dropdown.contact2 = ?
      OR booking_attendees_dropdown.contact3 = ?
      OR CONCAT_WS(' ', TRIM(booking_attendees_dropdown.first_name), TRIM(booking_attendees_dropdown.sur_name)) LIKE ?
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

async function getLicenceTypes(pool) {
  const [rows] = await pool.query(
    'SELECT id, licence_type FROM driving_licence_types ORDER BY id ASC'
  );
  return rows || [];
}

async function licenseNumberExists(pool, licenseNumber, excludeId = 0) {
  const licence = trim(licenseNumber);
  if (!licence) {
    return false;
  }

  const normalized = licence.toUpperCase();
  const exclude = Number(excludeId) || 0;

  if (exclude > 0) {
    const [rows] = await pool.query(
      'SELECT id FROM booking_attendees_dropdown WHERE license_number = ? AND id != ? LIMIT 1',
      [normalized, exclude]
    );
    return Boolean(rows?.length);
  }

  const [rows] = await pool.query(
    'SELECT id FROM booking_attendees_dropdown WHERE license_number = ? LIMIT 1',
    [normalized]
  );
  return Boolean(rows?.length);
}

function normalizeContactCardPayload(body) {
  const licenseNumber = trim(body?.license_number);
  return {
    first_name: ucWords(body?.first_name),
    sur_name: ucWords(body?.sur_name),
    email: trim(body?.email),
    contact1: stripPhoneSpaces(body?.contact1),
    contact2: stripPhoneSpaces(body?.contact2),
    date_of_birth: parseDateOfBirthInput(body?.date_of_birth),
    vehicle_type: trim(body?.vehicle_type),
    license_type: trim(body?.license_type),
    license_number: licenseNumber ? licenseNumber.toUpperCase() : '',
    theory_number: trim(body?.theory_number),
    notes: encodeNotesForSave(body?.notes),
  };
}

function mapListItem(row) {
  return {
    id: Number(row.id),
    first_name: trim(row.first_name),
    sur_name: trim(row.sur_name),
    email: trim(row.email),
    contact1: trim(row.contact1),
    contact2: trim(row.contact2),
    contact3: trim(row.contact3),
    license_number: trim(row.license_number),
    notes: trim(row.notes),
  };
}

function mapContactCardForm(row) {
  return {
    id: Number(row.id),
    first_name: trim(row.first_name),
    sur_name: trim(row.sur_name),
    email: trim(row.email),
    contact1: trim(row.contact1),
    contact2: trim(row.contact2),
    date_of_birth: formatDateOfBirthForForm(row.date_of_birth),
    vehicle_type: trim(row.vehicle_type),
    license_type: row.license_type != null ? String(row.license_type) : '',
    license_number: trim(row.license_number),
    theory_number: trim(row.theory_number),
    notes: decodeNotesForForm(row.notes),
  };
}

async function listContactCards(pool, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const { where, params } = buildListWhere(query.name_scr);
  const offset = (page - 1) * RECORDS_PER_PAGE;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM booking_attendees_dropdown${where}`,
    params
  );
  const total = Number(countRows[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT booking_attendees_dropdown.*
     FROM booking_attendees_dropdown
     ${where}
     ORDER BY booking_attendees_dropdown.id DESC
     LIMIT ? OFFSET ?`,
    [...params, RECORDS_PER_PAGE, offset]
  );

  const licenceTypes = await getLicenceTypes(pool);

  return {
    items: (rows || []).map(mapListItem),
    licenceTypes,
    pagination: {
      page,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
  };
}

async function getContactCard(pool, id) {
  const cardId = Number(id);
  if (!Number.isFinite(cardId) || cardId <= 0) {
    return { ok: false, message: 'Contact not found to edit' };
  }

  const [rows] = await pool.query(
    'SELECT * FROM booking_attendees_dropdown WHERE id = ? LIMIT 1',
    [cardId]
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, message: 'Contact not found to edit' };
  }

  const licenceTypes = await getLicenceTypes(pool);
  return {
    ok: true,
    data: {
      ...mapContactCardForm(row),
      licenceTypes,
    },
  };
}

async function createContactCard(pool, body) {
  const payload = normalizeContactCardPayload(body);

  if (await licenseNumberExists(pool, payload.license_number, 0)) {
    return { ok: false, message: DUPLICATE_LICENSE_MESSAGE, code: 'duplicate_license' };
  }

  const now = formatTimestamp();
  const [result] = await pool.query(
    `INSERT INTO booking_attendees_dropdown
      (first_name, sur_name, email, contact1, contact2, date_of_birth,
       vehicle_type, license_type, license_number, theory_number, notes, created, updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.first_name,
      payload.sur_name,
      payload.email,
      payload.contact1,
      payload.contact2,
      payload.date_of_birth,
      payload.vehicle_type,
      payload.license_type,
      payload.license_number,
      payload.theory_number,
      payload.notes,
      now,
      now,
    ]
  );

  if (result?.insertId) {
    return {
      ok: true,
      message: 'Client Contact added successfully',
      id: Number(result.insertId),
    };
  }

  return { ok: false, message: 'Error in adding contact' };
}

async function updateContactCard(pool, id, body) {
  const cardId = Number(id);
  if (!Number.isFinite(cardId) || cardId <= 0) {
    return { ok: false, message: 'Contact not found to edit' };
  }

  const [existingRows] = await pool.query(
    'SELECT id FROM booking_attendees_dropdown WHERE id = ? LIMIT 1',
    [cardId]
  );
  if (!existingRows?.length) {
    return { ok: false, message: 'Contact not found to edit' };
  }

  const payload = normalizeContactCardPayload(body);

  if (await licenseNumberExists(pool, payload.license_number, cardId)) {
    return { ok: false, message: DUPLICATE_LICENSE_MESSAGE, code: 'duplicate_license' };
  }

  const now = formatTimestamp();
  const [result] = await pool.query(
    `UPDATE booking_attendees_dropdown
     SET first_name = ?, sur_name = ?, email = ?, contact1 = ?, contact2 = ?,
         date_of_birth = ?, vehicle_type = ?, license_type = ?, license_number = ?,
         theory_number = ?, notes = ?, updated = ?
     WHERE id = ?`,
    [
      payload.first_name,
      payload.sur_name,
      payload.email,
      payload.contact1,
      payload.contact2,
      payload.date_of_birth,
      payload.vehicle_type,
      payload.license_type,
      payload.license_number,
      payload.theory_number,
      payload.notes,
      now,
      cardId,
    ]
  );

  if (result?.affectedRows > 0) {
    return { ok: true, message: 'Client Contact edited successfully' };
  }

  return { ok: false, message: 'Error in updating contact' };
}

async function deleteContactCard(pool, id) {
  const cardId = Number(id);
  if (!Number.isFinite(cardId) || cardId <= 0) {
    return { ok: false, message: 'Contact not found to delete' };
  }

  const [existingRows] = await pool.query(
    'SELECT id FROM booking_attendees_dropdown WHERE id = ? LIMIT 1',
    [cardId]
  );
  if (!existingRows?.length) {
    return { ok: false, message: 'Contact not found to delete' };
  }

  const [result] = await pool.query(
    'DELETE FROM booking_attendees_dropdown WHERE id = ?',
    [cardId]
  );

  if (result?.affectedRows > 0) {
    return { ok: true, message: 'Contact deleted successfully' };
  }

  return { ok: false, message: 'Error in deleting contact' };
}

module.exports = {
  listContactCards,
  getContactCard,
  createContactCard,
  updateContactCard,
  deleteContactCard,
  DUPLICATE_LICENSE_MESSAGE,
};
