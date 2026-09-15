/**
 * Admin DL196 returns — port of dl_returns*.php and dl_returns.class.php
 */
const RECORDS_PER_PAGE = 10;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function toMysqlDate(value) {
  const raw = trim(value);
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function checkBookNoExists(pool, bookNo, excludeId = 0) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM dl_returns WHERE book_no = ? AND id != ?',
    [trim(bookNo), Number(excludeId) || 0]
  );
  return Number(rows[0]?.cnt) > 0;
}

async function listDlReturns(pool, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const params = [];
  let where = 'WHERE 1 = 1';

  const filters = {
    book_scr: trim(query.book_scr ?? query.name_scr),
    date_scr: trim(query.date_scr),
    cert_scr: trim(query.cert_scr),
    loc_scr: trim(query.loc_scr),
    lock_scr: trim(query.lock_scr),
    name_scr: trim(query.attendee_scr ?? query.name_scr),
    licence_scr: trim(query.licence_scr),
    status_scr: trim(query.status_scr),
  };

  if (filters.book_scr) {
    where += ' AND dl.book_no LIKE ?';
    params.push(`${filters.book_scr}`);
  }
  if (filters.date_scr) {
    where += ' AND dlc.completion_date = ?';
    params.push(toMysqlDate(filters.date_scr));
  }
  if (filters.cert_scr) {
    where += ' AND dlc.certificate_no LIKE ?';
    params.push(filters.cert_scr);
  }
  if (filters.loc_scr) {
    where += ' AND dl.location_id LIKE ?';
    params.push(filters.loc_scr);
  }
  if (filters.lock_scr) {
    where += ' AND dl.is_locked LIKE ?';
    params.push(filters.lock_scr);
  }
  if (filters.name_scr) {
    where += ' AND dlc.attendee_name LIKE ?';
    params.push(`%${filters.name_scr}%`);
  }
  if (filters.licence_scr) {
    where += ' AND dlc.attendee_licence LIKE ?';
    params.push(`%${filters.licence_scr}%`);
  }
  if (filters.status_scr) {
    where += ' AND dl.certificate_status LIKE ?';
    params.push(`%${filters.status_scr}%`);
  }

  const baseFrom = `
    FROM dl_returns AS dl
    LEFT JOIN dl_return_certificates AS dlc ON dl.id = dlc.dl_return_id
    LEFT JOIN locations ON locations.id = dl.location_id
  `;

  const [countGroups] = await pool.query(
    `SELECT dl.id ${baseFrom} ${where} GROUP BY dl.book_no`,
    params
  );
  const total = countGroups.length;
  const offset = (page - 1) * RECORDS_PER_PAGE;

  const [items] = await pool.query(
    `SELECT dl.id, dl.certificate_status, dl.location_id, dl.book_no,
      MIN(dlc.certificate_no) AS min_certificate_no,
      MAX(dlc.certificate_no) AS max_certificate_no,
      GROUP_CONCAT(DATE_FORMAT(dlc.completion_date, '%d-%m-%Y') ORDER BY dlc.id) AS comp_date,
      dl.is_locked, dl.exported_on, locations.location_name
     ${baseFrom} ${where}
     GROUP BY dl.book_no
     ORDER BY ABS(dl.book_no) DESC
     LIMIT ? OFFSET ?`,
    [...params, RECORDS_PER_PAGE, offset]
  );

  return {
    items: items.map((r) => ({
      id: Number(r.id),
      certificate_status: r.certificate_status || 'At-Office',
      location_id: Number(r.location_id) || 0,
      book_no: r.book_no || '',
      min_certificate_no: r.min_certificate_no,
      max_certificate_no: r.max_certificate_no,
      comp_date: r.comp_date || '',
      is_locked: Number(r.is_locked) || 0,
      exported_on: r.exported_on,
      location_name: r.location_name || '',
    })),
    pagination: {
      page,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters,
  };
}

async function getDlReturnBook(pool, id) {
  const bookId = Number(id);
  const [bookRows] = await pool.query(
    `SELECT dl.*, locations.location_name, courses.course_name
     FROM dl_returns dl
     LEFT JOIN locations ON locations.id = dl.location_id
     LEFT JOIN courses ON courses.id = dl.course_id
     WHERE dl.id = ? LIMIT 1`,
    [bookId]
  );
  const book = bookRows[0];
  if (!book) return null;
  const [certificates] = await pool.query(
    `SELECT dlc.* FROM dl_return_certificates dlc
     WHERE dlc.dl_return_id = ?
     ORDER BY dlc.certificate_no ASC`,
    [bookId]
  );
  return {
    book: {
      id: Number(book.id),
      location_id: Number(book.location_id) || 0,
      course_id: Number(book.course_id) || 0,
      book_no: book.book_no || '',
      starting_certificate: book.starting_certificate,
      certificate_status: book.certificate_status || 'At-Office',
      atb_no: book.atb_no || '',
      is_locked: Number(book.is_locked) || 0,
      is_sent: Number(book.is_sent) || 0,
      exported_on: book.exported_on,
      location_name: book.location_name || '',
      course_name: book.course_name || '',
      created: book.created,
    },
    certificates: certificates.map((c) => ({
      id: Number(c.id),
      dl_return_id: Number(c.dl_return_id),
      certificate_no: c.certificate_no,
      book_no: c.book_no || '',
      atb_no: c.atb_no || '',
      completion_date: c.completion_date,
      attendee_name: c.attendee_name || '',
      attendee_licence: c.attendee_licence || '',
      certificate_voided: c.certificate_voided || 'no',
      duplicate_certificate: c.duplicate_certificate || 'no',
    })),
  };
}

async function getDlFormOptions(pool, locationId) {
  const [locations] = await pool.query(
    'SELECT id, location_name FROM locations WHERE show_in_dl_return = 1 ORDER BY location_name'
  );
  let courses = [];
  const locId = Number(locationId);
  if (locId) {
    const [courseRows] = await pool.query(
      `SELECT DISTINCT c.id, c.course_name
       FROM courses c
       JOIN course_events ce ON c.id = ce.course_id
       WHERE c.is_cbt = 1 AND ce.status = '1' AND ce.location_id = ?
       ORDER BY c.course_name`,
      [locId]
    );
    courses = courseRows.map((r) => ({
      id: Number(r.id),
      label: r.course_name || '',
    }));
  }
  const [franchises] = await pool.query(
    "SELECT id, atb_number, franchise_name FROM franchise WHERE status = '1' AND isDeleted = '0'"
  );
  return {
    locations: locations.map((r) => ({
      id: Number(r.id),
      label: r.location_name || '',
    })),
    courses,
    franchises: franchises.map((r) => ({
      id: Number(r.id),
      atb_number: r.atb_number || '',
      franchise_name: r.franchise_name || '',
    })),
    certificate_status_options: ['At-Office', 'On-Site'],
  };
}

async function createDlReturnBook(pool, body, session) {
  const locationId = Number(body.location_id);
  const courseId = Number(body.course_id);
  const bookNo = trim(body.book_no);
  const firstCert = trim(body.first_cbt_certificate ?? body.starting_certificate);
  const certStatus = trim(body.certificate_status);
  const atbNo = trim(body.atb_no);

  if (
    !locationId ||
    !courseId ||
    !bookNo ||
    !firstCert ||
    !atbNo ||
    !certStatus
  ) {
    const err = new Error('Required fields can not be left blank');
    err.code = 'VALIDATION';
    throw err;
  }
  if (!/^\d+$/.test(bookNo)) {
    const err = new Error('Book No must be a number');
    err.code = 'VALIDATION';
    throw err;
  }
  if (!/^\d+$/.test(firstCert)) {
    const err = new Error('Certificate No must be a number');
    err.code = 'VALIDATION';
    throw err;
  }
  if (await checkBookNoExists(pool, bookNo, 0)) {
    const err = new Error('Book No is already exists');
    err.code = 'DUPLICATE';
    throw err;
  }

  const ts = nowMysql();
  const updatedByName = `${session?.admin_fristname || ''} ${session?.admin_lastname || ''}`.trim();
  const updatedById = Number(session?.loggedinAdmin?.admin_id) || 0;
  const startNum = Number(firstCert);

  const [bookResult] = await pool.query(
    `INSERT INTO dl_returns (
      location_id, course_id, book_no, starting_certificate, certificate_status, atb_no, created
    ) VALUES (?,?,?,?,?,?,?)`,
    [locationId, courseId, bookNo, startNum, certStatus, atbNo, ts]
  );
  const bookId = bookResult.insertId;

  for (let cer = startNum; cer < startNum + 25; cer += 1) {
    await pool.query(
      `INSERT INTO dl_return_certificates (
        dl_return_id, course_event_id, book_no, atb_no, certificate_no,
        completion_date, completion_time, duration,
        attendee_name, attendee_licence, instructor_id, instructor_certificate,
        restriction, transmission, created, updated, updated_by, updated_by_name, updated_by_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        bookId,
        0,
        bookNo,
        atbNo,
        cer,
        '',
        '',
        0,
        '',
        '',
        0,
        '',
        '',
        '',
        ts,
        ts,
        'admin',
        updatedByName,
        updatedById,
      ]
    );
  }

  return getDlReturnBook(pool, bookId);
}

async function deleteDlReturnBook(pool, id) {
  const bookId = Number(id);
  const [rows] = await pool.query('SELECT id FROM dl_returns WHERE id = ?', [
    bookId,
  ]);
  if (!rows[0]) {
    const err = new Error('DL196 Book not found to delete');
    err.code = 'NOT_FOUND';
    throw err;
  }
  await pool.query('DELETE FROM dl_returns WHERE id = ?', [bookId]);
  await pool.query('DELETE FROM dl_return_certificates WHERE dl_return_id = ?', [
    bookId,
  ]);
}

async function updateDlCertificateStatus(pool, bookId, status) {
  const id = Number(bookId);
  const nextStatus = trim(status);
  if (!id || !nextStatus) {
    const err = new Error('Invalid status update');
    err.code = 'VALIDATION';
    throw err;
  }
  await pool.query('UPDATE dl_returns SET certificate_status = ? WHERE id = ?', [
    nextStatus,
    id,
  ]);
  return { message: 'Status updated successfully.' };
}

async function getDlCertificate(pool, id) {
  const certId = Number(id);
  const [rows] = await pool.query(
    'SELECT * FROM dl_return_certificates WHERE id = ? LIMIT 1',
    [certId]
  );
  return rows[0] || null;
}

async function updateDlCertificate(pool, id, body, session) {
  const certId = Number(id);
  const [rows] = await pool.query(
    'SELECT * FROM dl_return_certificates WHERE id = ? LIMIT 1',
    [certId]
  );
  const cert = rows[0];
  if (!cert) {
    const err = new Error('Certificate not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const ts = nowMysql();
  const updatedByName = `${session?.admin_fristname || ''} ${session?.admin_lastname || ''}`.trim();
  const updatedById = Number(session?.loggedinAdmin?.admin_id) || 0;

  await pool.query(
    `UPDATE dl_return_certificates SET
      completion_date = ?, start_time = ?, completion_time = ?, duration = ?,
      attendee_name = ?, attendee_licence = ?, instructor_id = ?, instructor_certificate = ?,
      restriction = ?, transmission = ?,
      certificate_voided = ?, duplicate_certificate = ?,
      updated = ?, updated_by_name = ?, updated_by_id = ?
     WHERE id = ?`,
    [
      toMysqlDate(body.completion_date ?? body.complition_date),
      trim(body.start_time ?? body.complition_time),
      trim(body.completion_time),
      Number(body.duration ?? body.course_duration) || 0,
      trim(body.attendee_name ?? body.driver),
      trim(body.attendee_licence ?? body.driver_licence),
      Number(body.instructor_id ?? body.instructor_certificate) || 0,
      trim(body.instructor_certificate),
      trim(body.restriction ?? body.ristriction),
      trim(body.transmission),
      body.certificate_voided === 'yes' ? 'yes' : 'no',
      body.duplicate_certificate === 'yes' ? 'yes' : 'no',
      ts,
      updatedByName,
      updatedById,
      certId,
    ]
  );
  return getDlCertificate(pool, certId);
}

module.exports = {
  listDlReturns,
  getDlReturnBook,
  getDlFormOptions,
  createDlReturnBook,
  deleteDlReturnBook,
  updateDlCertificateStatus,
  getDlCertificate,
  updateDlCertificate,
};
