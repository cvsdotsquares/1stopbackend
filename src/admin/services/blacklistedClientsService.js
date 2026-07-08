const RECORDS_PER_PAGE = 10;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function nl2br(text) {
  return String(text || '')
    .replace(/\r\n/g, '<br />')
    .replace(/\n/g, '<br />')
    .replace(/\r/g, '<br />');
}

function buildListWhere(nameScr) {
  const term = trim(nameScr);
  const where =
    " WHERE booking_attendees_dropdown.id != '' AND booking_attendees_dropdown.is_blacklisted = 1";
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
      OR booking_attendees_dropdown.license_number = ?
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
      term,
      `%${term}%`,
    ],
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
    notes: row.notes == null ? '' : String(row.notes),
  };
}

async function listBlacklistedClients(pool, query = {}) {
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

  return {
    items: (rows || []).map(mapListItem),
    pagination: {
      page,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
  };
}

function buildContactNo(dataArray) {
  let contactNo = '';
  if (trim(dataArray.contact1)) {
    contactNo = trim(dataArray.contact1);
  }
  if (trim(dataArray.contact2)) {
    contactNo += `${contactNo ? '<br/>' : ''}${trim(dataArray.contact2)}`;
  }
  if (trim(dataArray.contact3)) {
    contactNo += `${contactNo ? '<br/>' : ''}${trim(dataArray.contact3)}`;
  }
  return contactNo;
}

async function fetchLicenceDetails(pool, licenceNo) {
  const licence = trim(licenceNo);
  if (!licence) {
    return {
      status: 0,
      data: null,
      message: 'No Client found with this licence',
    };
  }

  const [rows] = await pool.query(
    `SELECT * FROM booking_attendees_dropdown WHERE license_number = ? LIMIT 1`,
    [licence]
  );
  const dataArray = rows?.[0];

  if (!dataArray?.id) {
    return {
      status: 0,
      data: null,
      message: 'No Client found with this licence',
    };
  }

  if (Number(dataArray.is_blacklisted) === 1) {
    return {
      status: 0,
      data: null,
      message: 'This client is already in blacklist',
    };
  }

  return {
    status: 1,
    data: {
      id: Number(dataArray.id),
      full_name: `${trim(dataArray.first_name)} ${trim(dataArray.sur_name)}`.trim(),
      contact_no: buildContactNo(dataArray),
      email: trim(dataArray.email),
      license_number: trim(dataArray.license_number),
      notes: dataArray.notes == null ? '' : String(dataArray.notes),
    },
    message: '',
  };
}

async function getContactById(pool, clientId) {
  const id = Number(clientId);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT id FROM booking_attendees_dropdown WHERE id = ? AND id != '' LIMIT 1`,
    [id]
  );
  return rows?.[0] || null;
}

async function markAsBlacklisted(pool, clientId, notes) {
  const contact = await getContactById(pool, clientId);
  if (!contact) {
    return {
      ok: false,
      message: 'Contact not found',
    };
  }

  const notesValue = nl2br(trim(notes));
  const [result] = await pool.query(
    `UPDATE booking_attendees_dropdown SET is_blacklisted = 1, notes = ? WHERE id = ?`,
    [notesValue, Number(clientId)]
  );

  if (!result?.affectedRows) {
    return {
      ok: false,
      message: 'Unable to add client to blacklist',
    };
  }

  return {
    ok: true,
    message: 'Client successfully added into blacklist',
  };
}

async function removeFromBlacklist(pool, clientId) {
  const contact = await getContactById(pool, clientId);
  if (!contact) {
    return {
      ok: false,
      message: 'Contact not found to remove from blacklist',
    };
  }

  const [result] = await pool.query(
    `UPDATE booking_attendees_dropdown SET is_blacklisted = 0 WHERE id = ?`,
    [Number(clientId)]
  );

  if (!result?.affectedRows) {
    return {
      ok: false,
      message: 'Error in removing client from blacklist',
    };
  }

  return {
    ok: true,
    message: 'Client successfully removed from blacklist',
  };
}

module.exports = {
  listBlacklistedClients,
  fetchLicenceDetails,
  markAsBlacklisted,
  removeFromBlacklist,
};
