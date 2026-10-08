const { parseActiveStatus } = require('./adminStatus');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

const PER_PAGE = 10;

async function listContactOffices(pool, { page = 1, name_scr = '' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PER_PAGE;
  let where = ' WHERE 1=1 ';
  const params = [];
  const search = trim(name_scr);
  if (search) {
    where += ' AND lname LIKE ?';
    params.push(`%${search}%`);
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM contact_offices ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM contact_offices ${where} ORDER BY weight ASC, id ASC LIMIT ?, ?`,
    [...params, offset, PER_PAGE]
  );

  return {
    items: rows || [],
    pagination: {
      page: pageNum,
      perPage: PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
    },
    filters: { name_scr: search },
  };
}

async function getContactOfficeById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM contact_offices WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  return rows?.[0] || null;
}

async function createContactOffice(pool, body) {
  const lname = trim(body.lname);
  const latitude = trim(body.latitude);
  const longitude = trim(body.longitude);
  const content = trim(body.content);
  const weight = trim(body.weight) || '0';
  const status = parseActiveStatus(body.status, 1);

  if (!lname || !latitude || !longitude || !content) {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }

  const [result] = await pool.query(
    `INSERT INTO contact_offices (lname, latitude, longitude, content, weight, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [lname, latitude, longitude, content, weight, status]
  );

  return { ok: true, message: 'Contact office added successfully', id: result.insertId };
}

async function updateContactOffice(pool, id, body) {
  const existing = await getContactOfficeById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Contact office not found' };
  }

  const lname = trim(body.lname);
  const latitude = trim(body.latitude);
  const longitude = trim(body.longitude);
  const content = trim(body.content);
  const weight = trim(body.weight) || '0';
  const status = parseActiveStatus(
    body.status,
    Number(existing.status) === 1 ? 1 : 0
  );

  if (!lname || !latitude || !longitude || !content) {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }

  await pool.query(
    `UPDATE contact_offices SET lname = ?, latitude = ?, longitude = ?, content = ?, weight = ?, status = ?
     WHERE id = ?`,
    [lname, latitude, longitude, content, weight, status, Number(id)]
  );

  return { ok: true, message: 'Contact office edited successfully' };
}

async function deleteContactOffice(pool, id) {
  const existing = await getContactOfficeById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Contact office not found to delete' };
  }
  await pool.query('DELETE FROM contact_offices WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Contact office deleted successfully' };
}

module.exports = {
  listContactOffices,
  getContactOfficeById,
  createContactOffice,
  updateContactOffice,
  deleteContactOffice,
};
