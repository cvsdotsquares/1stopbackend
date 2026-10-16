/**
 * Service for Instructor Schedule Access (F-074 / itinerary/itinerary_list.php, add_itinerary.php, edit_itinerary.php)
 * Table: itineraries
 */

const { mc_encrypt } = require('../../utils/universalPassword');

function getEncryptionKey() {
  return process.env.UNIVERSAL_PASSWORD_KEY || process.env.ENCRYPTION_KEY;
}

function isValidEmail(value) {
  const email = String(value || '').trim();
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * List instructors with search and optional status filtering
 */
async function listInstructors(
  pool,
  { page = 1, limit = 0, search = '', status = '' } = {}
) {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Number(limit) > 0 ? Number(limit) : 0;
  const offset = (pageNum - 1) * pageSize;

  let where = ' WHERE 1=1 ';
  const params = [];
  const trimmedSearch = String(search || '').trim();

  if (trimmedSearch) {
    where += ` AND (
      i.fname LIKE ? OR
      i.lname LIKE ? OR
      CONCAT(i.fname, ' ', i.lname) LIKE ? OR
      i.email LIKE ? OR
      i.username LIKE ? OR
      i.instructor_certificate_number LIKE ?
    )`;
    const wildcard = `%${trimmedSearch}%`;
    params.push(wildcard, wildcard, wildcard, wildcard, wildcard, wildcard);
  }

  if (status !== '' && status !== undefined && status !== null) {
    where += ' AND i.status = ? ';
    params.push(Number(status));
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM itineraries i
     ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;

  let limitClause = '';
  const queryParams = [...params];
  if (pageSize > 0) {
    limitClause = ' LIMIT ?, ? ';
    queryParams.push(offset, pageSize);
  }

  const [rows] = await pool.query(
    `SELECT
      i.id,
      i.fname,
      i.lname,
      i.email,
      i.username,
      i.instructor_certificate_number,
      i.location,
      COALESCE(l.location_name, 'All Locations') AS location_name,
      i.status,
      i.last_login,
      i.created
    FROM itineraries i
    LEFT JOIN locations l ON l.id = i.location
    ${where}
    ORDER BY i.username ASC, i.fname ASC, i.lname ASC, i.id ASC
    ${limitClause}`,
    queryParams
  );

  return {
    items: (rows || []).map((row) => ({
      id: Number(row.id),
      fname: String(row.fname || ''),
      lname: String(row.lname || ''),
      name: `${row.fname || ''} ${row.lname || ''}`.trim(),
      email: String(row.email || ''),
      username: String(row.username || ''),
      instructor_certificate_number: String(row.instructor_certificate_number || ''),
      location: Number(row.location) || 0,
      location_name: row.location === 0 ? 'All Locations' : String(row.location_name || 'All Locations'),
      status: Number(row.status) === 1 ? 1 : 0,
      last_login: row.last_login || null,
      created: row.created || null,
    })),
    pagination: {
      page: pageNum,
      limit: pageSize > 0 ? pageSize : total,
      total,
      totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    },
  };
}

/**
 * Get instructor by ID
 */
async function getInstructorById(pool, instructorId) {
  const id = Number(instructorId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const [rows] = await pool.query(
    `SELECT
      i.id,
      i.fname,
      i.lname,
      i.email,
      i.username,
      i.instructor_certificate_number,
      i.location,
      COALESCE(l.location_name, 'All Locations') AS location_name,
      i.status,
      i.last_login,
      i.created
    FROM itineraries i
    LEFT JOIN locations l ON l.id = i.location
    WHERE i.id = ?
    LIMIT 1`,
    [id]
  );

  if (!rows || rows.length === 0) return null;
  const row = rows[0];

  return {
    id: Number(row.id),
    fname: String(row.fname || ''),
    lname: String(row.lname || ''),
    email: String(row.email || ''),
    username: String(row.username || ''),
    instructor_certificate_number: String(row.instructor_certificate_number || ''),
    location: Number(row.location) || 0,
    location_name: row.location === 0 ? 'All Locations' : String(row.location_name || 'All Locations'),
    status: Number(row.status) === 1 ? 1 : 0,
    last_login: row.last_login || null,
    created: row.created || null,
  };
}

/**
 * Create instructor (add_itinerary.php parity)
 */
async function createInstructor(pool, data) {
  const fname = String(data.fname || '').trim();
  const lname = String(data.lname || '').trim();
  const email = String(data.email || '').trim();
  const username = String(data.username || '').trim();
  const rawPass = String(data.pass || '').trim();
  const certNumber = String(data.instructor_certificate_number || '').trim();
  const location = Number(data.location) || 0;
  const status = Number(data.status) === 0 ? 0 : 1;

  if (!fname) {
    return { ok: false, message: 'First name is required' };
  }
  if (!lname) {
    return { ok: false, message: 'Last name is required' };
  }
  if (!email || !isValidEmail(email)) {
    return { ok: false, message: 'Please provide a valid email address' };
  }
  if (!username) {
    return { ok: false, message: 'Username is required' };
  }
  if (!rawPass) {
    return { ok: false, message: 'Password is required' };
  }

  // Check username uniqueness
  const [existingUser] = await pool.query(
    'SELECT id FROM itineraries WHERE username = ? LIMIT 1',
    [username]
  );
  if (existingUser && existingUser.length > 0) {
    return { ok: false, message: 'Username already exists. Please choose another.' };
  }

  // Check email uniqueness
  const [existingEmail] = await pool.query(
    'SELECT id FROM itineraries WHERE email = ? LIMIT 1',
    [email]
  );
  if (existingEmail && existingEmail.length > 0) {
    return { ok: false, message: 'Email already exists. Please choose another.' };
  }

  const keyHex = getEncryptionKey();
  if (!keyHex) {
    return { ok: false, message: 'Server encryption configuration error' };
  }

  const encryptedPass = mc_encrypt(rawPass, keyHex);

  const [result] = await pool.query(
    `INSERT INTO itineraries (
      fname,
      lname,
      email,
      username,
      pass,
      instructor_certificate_number,
      location,
      status,
      created
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [fname, lname, email, username, encryptedPass, certNumber, location, status]
  );

  return {
    ok: true,
    message: 'Instructor added successfully',
    id: result.insertId,
  };
}

/**
 * Update instructor (edit_itinerary.php parity)
 */
async function updateInstructor(pool, instructorId, data) {
  const id = Number(instructorId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid instructor ID' };
  }

  const existing = await getInstructorById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Instructor not found' };
  }

  const fname = String(data.fname || '').trim();
  const lname = String(data.lname || '').trim();
  const email = String(data.email || '').trim();
  const username = String(data.username || '').trim();
  const rawPass = String(data.pass || '').trim();
  const certNumber = String(data.instructor_certificate_number || '').trim();
  const location = data.location !== undefined ? Number(data.location) || 0 : existing.location;
  const status = data.status !== undefined ? (Number(data.status) === 0 ? 0 : 1) : existing.status;

  if (!fname) {
    return { ok: false, message: 'First name is required' };
  }
  if (!lname) {
    return { ok: false, message: 'Last name is required' };
  }
  if (!email || !isValidEmail(email)) {
    return { ok: false, message: 'Please provide a valid email address' };
  }
  if (!username) {
    return { ok: false, message: 'Username is required' };
  }

  // Check username uniqueness
  const [existingUser] = await pool.query(
    'SELECT id FROM itineraries WHERE username = ? AND id != ? LIMIT 1',
    [username, id]
  );
  if (existingUser && existingUser.length > 0) {
    return { ok: false, message: 'Username already exists. Please choose another.' };
  }

  // Check email uniqueness
  const [existingEmail] = await pool.query(
    'SELECT id FROM itineraries WHERE email = ? AND id != ? LIMIT 1',
    [email, id]
  );
  if (existingEmail && existingEmail.length > 0) {
    return { ok: false, message: 'Email already exists. Please choose another.' };
  }

  if (rawPass) {
    const keyHex = getEncryptionKey();
    if (!keyHex) {
      return { ok: false, message: 'Server encryption configuration error' };
    }
    const encryptedPass = mc_encrypt(rawPass, keyHex);

    await pool.query(
      `UPDATE itineraries SET
        fname = ?,
        lname = ?,
        email = ?,
        username = ?,
        pass = ?,
        instructor_certificate_number = ?,
        location = ?,
        status = ?
      WHERE id = ?`,
      [fname, lname, email, username, encryptedPass, certNumber, location, status, id]
    );
  } else {
    await pool.query(
      `UPDATE itineraries SET
        fname = ?,
        lname = ?,
        email = ?,
        username = ?,
        instructor_certificate_number = ?,
        location = ?,
        status = ?
      WHERE id = ?`,
      [fname, lname, email, username, certNumber, location, status, id]
    );
  }

  return {
    ok: true,
    message: 'Instructor updated successfully',
    id,
  };
}

/**
 * Toggle instructor status (1 <-> 0)
 */
async function toggleInstructorStatus(pool, instructorId, statusOverride) {
  const id = Number(instructorId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid instructor ID' };
  }

  const existing = await getInstructorById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Instructor not found' };
  }

  const newStatus =
    statusOverride !== undefined && statusOverride !== null
      ? Number(statusOverride) === 1 ? 1 : 0
      : existing.status === 1 ? 0 : 1;

  await pool.query('UPDATE itineraries SET status = ? WHERE id = ?', [newStatus, id]);

  return {
    ok: true,
    message: `Instructor status set to ${newStatus === 1 ? 'Active' : 'Inactive'}`,
    status: newStatus,
  };
}

/**
 * Delete instructor
 */
async function deleteInstructor(pool, instructorId) {
  const id = Number(instructorId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid instructor ID' };
  }

  const existing = await getInstructorById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Instructor not found' };
  }

  await pool.query('DELETE FROM itineraries WHERE id = ?', [id]);

  return {
    ok: true,
    message: 'Instructor deleted successfully',
  };
}

module.exports = {
  listInstructors,
  getInstructorById,
  createInstructor,
  updateInstructor,
  toggleInstructorStatus,
  deleteInstructor,
};
