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
 * List admin users with search and pagination (F-071 / administrator.php parity)
 */
async function listAdminUsers(pool, { page = 1, limit = DEFAULT_PAGE_SIZE, search = '' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE);
  const offset = (pageNum - 1) * pageSize;

  let where = ' WHERE 1=1 ';
  const params = [];
  const trimmedSearch = String(search || '').trim();

  if (trimmedSearch) {
    where += ` AND (
      admin_username LIKE ? OR
      admin_fristname LIKE ? OR
      admin_lastname LIKE ? OR
      admin_email LIKE ?
    )`;
    const wildcard = `%${trimmedSearch}%`;
    params.push(wildcard, wildcard, wildcard, wildcard);
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM admin ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;

  const [rows] = await pool.query(
    `SELECT
      admin_id,
      admin_username,
      admin_email,
      admin_fristname,
      admin_lastname,
      role,
      status,
      created_on
    FROM admin
    ${where}
    ORDER BY admin_id ASC
    LIMIT ?, ?`,
    [...params, offset, pageSize]
  );

  return {
    items: rows || [],
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

/**
 * Get single admin user by ID
 */
async function getAdminUserById(pool, adminId) {
  const id = Number(adminId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const [rows] = await pool.query(
    `SELECT
      admin_id,
      admin_username,
      admin_email,
      admin_fristname,
      admin_lastname,
      role,
      status,
      created_on
    FROM admin
    WHERE admin_id = ?
    LIMIT 1`,
    [id]
  );

  return (rows && rows[0]) || null;
}

/**
 * Create new admin user (add_admin.php parity)
 */
async function createAdminUser(pool, data) {
  const firstName = String(data.admin_fristname || '').trim();
  const lastName = String(data.admin_lastname || '').trim();
  const email = String(data.admin_email || '').trim();
  const username = String(data.admin_username || '').trim();
  const rawPass = String(data.admin_pass || '').trim();
  const role = data.role === 'super' ? 'super' : 'member';
  const status = Number(data.status) === 0 ? 0 : 1;

  if (!firstName) {
    return { ok: false, message: 'First name is required' };
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
    'SELECT admin_id FROM admin WHERE admin_username = ? LIMIT 1',
    [username]
  );
  if (existingUser && existingUser.length > 0) {
    return { ok: false, message: 'Username already exists. Please choose another.' };
  }

  // Check email uniqueness
  const [existingEmail] = await pool.query(
    'SELECT admin_id FROM admin WHERE admin_email = ? LIMIT 1',
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
    `INSERT INTO admin (
      admin_fristname,
      admin_lastname,
      admin_email,
      admin_username,
      admin_pass,
      role,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [firstName, lastName, email, username, encryptedPass, role, status]
  );

  return {
    ok: true,
    message: 'User added successfully',
    id: result.insertId,
  };
}

/**
 * Update admin user (edit_admin.php parity)
 */
async function updateAdminUser(pool, adminId, data) {
  const id = Number(adminId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid admin ID' };
  }

  const existing = await getAdminUserById(pool, id);
  if (!existing) {
    return { ok: false, message: 'User not found' };
  }

  const firstName = data.admin_fristname !== undefined
    ? String(data.admin_fristname || '').trim()
    : existing.admin_fristname;
  const lastName = data.admin_lastname !== undefined
    ? String(data.admin_lastname || '').trim()
    : existing.admin_lastname;
  const email = data.admin_email !== undefined
    ? String(data.admin_email || '').trim()
    : existing.admin_email;
  const username = data.admin_username !== undefined
    ? String(data.admin_username || '').trim()
    : existing.admin_username;

  let role = existing.role;
  if (data.role !== undefined) {
    // Super admin role cannot be downgraded if id is 1
    if (id === 1 && data.role !== 'super') {
      return { ok: false, message: 'Primary Super Admin role cannot be changed' };
    }
    role = data.role === 'super' ? 'super' : 'member';
  }

  let status = existing.status;
  if (data.status !== undefined) {
    // Super admin cannot be deactivated
    if (existing.role === 'super' && Number(data.status) === 0) {
      return { ok: false, message: 'Super Admin cannot be deactivated' };
    }
    status = Number(data.status) === 1 ? 1 : 0;
  }

  if (!firstName) {
    return { ok: false, message: 'First name is required' };
  }
  if (!email || !isValidEmail(email)) {
    return { ok: false, message: 'Please provide a valid email address' };
  }
  if (!username) {
    return { ok: false, message: 'Username is required' };
  }

  // Check username uniqueness if changed
  if (username !== existing.admin_username) {
    const [dupUser] = await pool.query(
      'SELECT admin_id FROM admin WHERE admin_username = ? AND admin_id <> ? LIMIT 1',
      [username, id]
    );
    if (dupUser && dupUser.length > 0) {
      return { ok: false, message: 'Username already exists. Please choose another.' };
    }
  }

  // Check email uniqueness if changed
  if (email !== existing.admin_email) {
    const [dupEmail] = await pool.query(
      'SELECT admin_id FROM admin WHERE admin_email = ? AND admin_id <> ? LIMIT 1',
      [email, id]
    );
    if (dupEmail && dupEmail.length > 0) {
      return { ok: false, message: 'Email already exists. Please choose another.' };
    }
  }

  // Optional password update
  let encryptedPass = null;
  if (data.admin_pass && String(data.admin_pass).trim().length > 0) {
    const rawPass = String(data.admin_pass).trim();
    const keyHex = getEncryptionKey();
    if (!keyHex) {
      return { ok: false, message: 'Server encryption configuration error' };
    }
    encryptedPass = mc_encrypt(rawPass, keyHex);
  }

  if (encryptedPass) {
    await pool.query(
      `UPDATE admin SET
        admin_fristname = ?,
        admin_lastname = ?,
        admin_email = ?,
        admin_username = ?,
        admin_pass = ?,
        role = ?,
        status = ?
      WHERE admin_id = ?`,
      [firstName, lastName, email, username, encryptedPass, role, status, id]
    );
  } else {
    await pool.query(
      `UPDATE admin SET
        admin_fristname = ?,
        admin_lastname = ?,
        admin_email = ?,
        admin_username = ?,
        role = ?,
        status = ?
      WHERE admin_id = ?`,
      [firstName, lastName, email, username, role, status, id]
    );
  }

  return {
    ok: true,
    message: 'User updated successfully',
  };
}

/**
 * Toggle status of admin user (administrator.php parity)
 */
async function toggleAdminUserStatus(pool, adminId, newStatus = null) {
  const id = Number(adminId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid admin ID' };
  }

  const user = await getAdminUserById(pool, id);
  if (!user) {
    return { ok: false, message: 'User not found' };
  }

  if (user.role === 'super' || id === 1) {
    return { ok: false, message: 'Super Admin status cannot be changed.' };
  }

  const targetStatus = newStatus !== null ? (Number(newStatus) === 1 ? 1 : 0) : (user.status === 1 ? 0 : 1);

  await pool.query(
    'UPDATE admin SET status = ? WHERE admin_id = ?',
    [targetStatus, id]
  );

  return {
    ok: true,
    message: 'User status updated successfully',
    status: targetStatus,
  };
}

/**
 * Delete admin user (administrator.php parity - protects super admin)
 */
async function deleteAdminUser(pool, adminId) {
  const id = Number(adminId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid admin ID' };
  }

  const user = await getAdminUserById(pool, id);
  if (!user) {
    return { ok: false, message: 'User not found' };
  }

  if (user.role === 'super' || id === 1) {
    return { ok: false, message: 'Super Admin cannot be deleted.' };
  }

  await pool.query('DELETE FROM admin WHERE admin_id = ?', [id]);

  return {
    ok: true,
    message: 'User deleted successfully',
  };
}

module.exports = {
  listAdminUsers,
  getAdminUserById,
  createAdminUser,
  updateAdminUser,
  toggleAdminUserStatus,
  deleteAdminUser,
};
