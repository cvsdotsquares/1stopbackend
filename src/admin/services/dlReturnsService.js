/**
 * Admin DL196 returns — port of dl_returns*.php and dl_returns.class.php
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { getMailFrom, getMailFromAddress } = require('../../utils/mailFrom');
const { validateDrivingLicenceNumber } = require('../../utils/drivingLicenceValidation');

const RECORDS_PER_PAGE = 10;
const VEHICLE_TYPE_LABELS = { 0: 'Manual', 1: 'Automatic', 3: 'Own vehicle' };

const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: smtpSecure,
  requireTLS:
    !smtpSecure &&
    String(process.env.SMTP_REQUIRE_TLS ?? 'true').toLowerCase() !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

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
  const dmy = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) {
    const p = (n) => String(n).padStart(2, '0');
    const iso = `${dmy[3]}-${p(dmy[2])}-${p(dmy[1])}`;
    return normalizeCompletionDate(iso);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return normalizeCompletionDate(raw.slice(0, 10));
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return normalizeCompletionDate(
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  );
}

function isEmptyCompletionIso(iso) {
  if (!iso) return true;
  if (iso.startsWith('0000')) return true;
  if (iso === '1970-01-01' || iso === '1899-11-30' || iso === '1899-12-30') return true;
  const y = parseInt(iso.slice(0, 4), 10);
  return Number.isFinite(y) && y < 1901;
}

/** Empty / zero DATE columns from legacy MySQL — do not show as a real date in admin UI */
function normalizeCompletionDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    const iso = `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
    return isEmptyCompletionIso(iso) ? '' : iso;
  }
  const raw = trim(value).slice(0, 10);
  if (!raw || isEmptyCompletionIso(raw)) return '';
  return raw;
}

function formatCompDateRange(compDate) {
  if (!compDate) return '';
  const expDates = String(compDate)
    .split(',')
    .map((d) => d.trim())
    .filter(
      (d) =>
        d &&
        d !== '01-01-1970' &&
        d !== '00-00-0000' &&
        d !== '30-11-1899' &&
        d !== '01-01-1899'
    );
  if (!expDates.length) return '';
  const toSlash = (d) => {
    const parts = d.split('-');
    if (parts.length !== 3) return '';
    return `${parts[0]}/${parts[1]}/${parts[2]}`;
  };
  let firstDate = toSlash(expDates[0]);
  if (
    firstDate === '01/01/1970' ||
    firstDate === '00/00/0000' ||
    firstDate === '30/11/1899'
  ) {
    firstDate = '';
  }
  let lastDate = '';
  if (expDates.length > 1) {
    const end = expDates[expDates.length - 1];
    if (
      end !== '00-00-0000' &&
      end !== '01-01-1970' &&
      end !== '30-11-1899'
    ) {
      if (firstDate) {
        lastDate = ` - ${toSlash(end)}`;
      } else {
        lastDate = toSlash(end);
      }
    }
  }
  return `${firstDate}${lastDate}`;
}

function formatExportedOn(value) {
  const raw = value == null ? '' : String(value);
  if (!raw || raw.startsWith('0000-00-00')) return 'NA';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 'NA';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function resolveAdminSiteEmail() {
  return (
    process.env.MAIL_FROM_EMAIL ||
    process.env.CONTACT_FROM ||
    process.env.SMTP_USER ||
    ''
  ).trim();
}

function transmissionLabel(value) {
  if (value === '' || value == null) return '';
  const key = Number(value);
  return VEHICLE_TYPE_LABELS[key] ?? String(value);
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
    book_scr: trim(query.book_scr),
    date_scr: trim(query.date_scr),
    cert_scr: trim(query.cert_scr),
    loc_scr: trim(query.loc_scr),
    lock_scr: trim(query.lock_scr),
    pupname_scr: trim(query.pupname_scr ?? query.attendee_scr ?? query.name_scr),
    licence_scr: trim(query.licence_scr),
    certificate_src: trim(
      query.certificate_src ?? query.status_scr ?? query.certificate_status
    ),
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
  if (filters.pupname_scr) {
    where += ' AND dlc.attendee_name LIKE ?';
    params.push(`%${filters.pupname_scr}%`);
  }
  if (filters.licence_scr) {
    where += ' AND dlc.attendee_licence LIKE ?';
    params.push(`%${filters.licence_scr}%`);
  }
  if (filters.certificate_src) {
    where += ' AND dl.certificate_status LIKE ?';
    params.push(`%${filters.certificate_src}%`);
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
      date_range: formatCompDateRange(r.comp_date || ''),
      is_locked: Number(r.is_locked) || 0,
      exported_on: r.exported_on,
      exported_on_display: formatExportedOn(r.exported_on),
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
    `SELECT dlc.*,
      CONCAT(i.fname, ' ', i.lname) AS instructor_name
     FROM dl_return_certificates dlc
     LEFT JOIN itineraries i ON i.id = dlc.instructor_id AND dlc.instructor_id > 0
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
      exported_on_display: formatExportedOn(book.exported_on),
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
      completion_date: normalizeCompletionDate(c.completion_date),
      start_time: c.start_time || '',
      completion_time: c.completion_time || '',
      duration: c.duration,
      attendee_id: Number(c.attendee_id) || 0,
      attendee_name: c.attendee_name || '',
      attendee_licence: c.attendee_licence || '',
      course_event_id: Number(c.course_event_id) || 0,
      instructor_id: Number(c.instructor_id) || 0,
      instructor_certificate: c.instructor_certificate || '',
      instructor_display:
        c.instructor_certificate && Number(c.instructor_id) > 0
          ? `${c.instructor_name || 'NA'}\n${c.instructor_certificate}`
          : 'NA',
      restriction: c.restriction || '',
      transmission: c.transmission,
      transmission_label: transmissionLabel(c.transmission),
      updated: c.updated,
      updated_by_name: c.updated_by_name || '',
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
       WHERE c.is_cbt = 1 AND ce.status = '1' AND c.status IN ('1', '2') AND ce.location_id = ?
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

  const connection = await pool.getConnection();
  let bookId = 0;
  try {
    await connection.beginTransaction();
    const [bookResult] = await connection.query(
      `INSERT INTO dl_returns (
        location_id, course_id, book_no, starting_certificate, certificate_status, atb_no, created
      ) VALUES (?,?,?,?,?,?,?)`,
      [locationId, courseId, bookNo, startNum, certStatus, atbNo, ts]
    );
    bookId = Number(bookResult.insertId);
    if (!bookId) {
      const err = new Error('Unable to create DL196 book');
      err.code = 'SERVER';
      throw err;
    }

    for (let cer = startNum; cer < startNum + 25; cer += 1) {
      await connection.query(
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
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  const loaded = await getDlReturnBook(pool, bookId);
  if (loaded?.book?.id) return loaded;

  return {
    book: {
      id: bookId,
      location_id: locationId,
      course_id: courseId,
      book_no: bookNo,
      starting_certificate: startNum,
      certificate_status: certStatus,
      atb_no: atbNo,
    },
    certificates: [],
  };
}

async function deleteDlReturnBook(pool, id) {
  const bookId = Number(id);
  const [rows] = await pool.query(
    'SELECT id, is_locked FROM dl_returns WHERE id = ?',
    [bookId]
  );
  if (!rows[0]) {
    const err = new Error('DL196 Book not found to delete');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (Number(rows[0].is_locked) === 1) {
    const err = new Error('Cannot delete a locked DL196 book');
    err.code = 'VALIDATION';
    throw err;
  }
  await pool.query('DELETE FROM dl_returns WHERE id = ?', [bookId]);
  await pool.query('DELETE FROM dl_return_certificates WHERE dl_return_id = ?', [
    bookId,
  ]);
}

async function listDlBooksByLocation(pool, locationId) {
  const locId = Number(locationId);
  if (!locId) return [];
  const [rows] = await pool.query(
    'SELECT id, book_no FROM dl_returns WHERE location_id = ? ORDER BY ABS(book_no) DESC',
    [locId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    book_no: r.book_no || '',
  }));
}

async function toggleDlReturnLock(pool, bookId) {
  const id = Number(bookId);
  const [rows] = await pool.query('SELECT is_locked FROM dl_returns WHERE id = ?', [
    id,
  ]);
  if (!rows[0]) {
    const err = new Error('DL196 book not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const next = Number(rows[0].is_locked) === 1 ? 0 : 1;
  await pool.query('UPDATE dl_returns SET is_locked = ? WHERE id = ?', [next, id]);
  await pool.query('UPDATE dl_return_certificates SET is_locked = ? WHERE dl_return_id = ?', [
    next,
    id,
  ]);
  return { is_locked: next };
}

async function resetDlReturnCertificate(pool, certificateId, session) {
  const certId = Number(certificateId);
  const [rows] = await pool.query(
    'SELECT id, dl_return_id FROM dl_return_certificates WHERE id = ?',
    [certId]
  );
  if (!rows[0]) {
    const err = new Error('Certificate not found to delete');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const ts = nowMysql();
  const updatedByName = `${session?.admin_fristname || ''} ${session?.admin_lastname || ''}`.trim();
  const updatedById = Number(session?.loggedinAdmin?.admin_id) || 0;
  await pool.query(
    `UPDATE dl_return_certificates SET
      course_event_id = 0, completion_date = '', completion_time = '', duration = 0,
      attendee_name = '', attendee_licence = '', instructor_id = 0, instructor_certificate = '',
      restriction = '', transmission = '', updated = ?, updated_by = 'admin',
      updated_by_name = ?, updated_by_id = ?, start_time = '', certificate_voided = 'no',
      duplicate_certificate = 'no'
     WHERE id = ?`,
    [ts, updatedByName, updatedById, certId]
  );
  return { dl_return_id: Number(rows[0].dl_return_id) };
}

async function updateDlReturnBookDetails(pool, bookId, body) {
  const id = Number(bookId);
  const locationId = Number(body.location_id);
  const courseId = Number(body.course_id);
  const bookNo = trim(body.book_no);
  const startingCert = trim(body.first_cbt_certificate ?? body.starting_certificate);
  const atbNo = trim(body.atb_no);

  if (!locationId || !courseId || !bookNo || !startingCert || !atbNo) {
    const err = new Error('Required fields can not be left blank');
    err.code = 'VALIDATION';
    throw err;
  }
  if (!/^\d+$/.test(bookNo)) {
    const err = new Error('Book No must be a number');
    err.code = 'VALIDATION';
    throw err;
  }
  if (await checkBookNoExists(pool, bookNo, id)) {
    const err = new Error('Book No is already exists');
    err.code = 'DUPLICATE';
    throw err;
  }

  await pool.query(
    `UPDATE dl_returns SET location_id = ?, course_id = ?, book_no = ?, starting_certificate = ?, atb_no = ? WHERE id = ?`,
    [locationId, courseId, bookNo, Number(startingCert), atbNo, id]
  );
  await pool.query('UPDATE dl_return_certificates SET atb_no = ? WHERE dl_return_id = ?', [
    atbNo,
    id,
  ]);
  const [certRows] = await pool.query(
    'SELECT id FROM dl_return_certificates WHERE dl_return_id = ? ORDER BY id ASC',
    [id]
  );
  const startNum = Number(startingCert);
  for (let k = 0; k < certRows.length; k += 1) {
    await pool.query('UPDATE dl_return_certificates SET certificate_no = ? WHERE id = ?', [
      startNum + k,
      certRows[k].id,
    ]);
  }
  return getDlReturnBook(pool, id);
}

async function exportDlReturnBook(pool, bookId, options = {}) {
  const id = Number(bookId);
  const send = trim(options.send) || 'admin';
  const resend = Number(options.resend) || 0;
  const customEmail = trim(options.email);

  const [rows] = await pool.query(
    `SELECT dlc.*, dl.course_id, dl.book_no
     FROM dl_returns dl
     LEFT JOIN dl_return_certificates dlc ON dl.id = dlc.dl_return_id
     WHERE dl.id = ?
     ORDER BY dlc.certificate_no ASC`,
    [id]
  );
  if (!rows.length || !rows[0].certificate_no) {
    const err = new Error('DL196 book not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  let recipient = resolveAdminSiteEmail();
  if (send === 'dvsa') {
    const [courseRows] = await pool.query(
      'SELECT dvsa_email FROM courses WHERE id = ? LIMIT 1',
      [rows[0].course_id]
    );
    recipient = trim(courseRows[0]?.dvsa_email) || recipient;
  } else if (send === 'custom' && customEmail) {
    recipient = customEmail;
  }

  if (!recipient) {
    const err = new Error('No recipient email configured');
    err.code = 'VALIDATION';
    throw err;
  }

  const firstCert = rows[0].certificate_no;
  const lastCert = rows[rows.length - 1].certificate_no;
  const filename = `DL196 Returns for certifictes numbers ${firstCert}-${lastCert}.csv`;
  const csvDir = path.join(__dirname, '../../../uploads/dl_returns_csv');
  fs.mkdirSync(csvDir, { recursive: true });
  const filepath = path.join(csvDir, filename);

  const header =
    'ATB Number,Certificate Number,Completion Date,Completion Time,Course Duration,Driver Number,Instructor Certificate,Restriction,Transmission\n';
  const lines = rows.map((v) => {
    const transmission =
      v.transmission !== '' && v.transmission != null
        ? transmissionLabel(v.transmission)
        : '';
    const esc = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    return [
      esc(`${v.atb_no}\t`),
      esc(`${v.certificate_no}\t`),
      esc(v.completion_date),
      esc(v.completion_time),
      esc(v.duration),
      esc(v.attendee_licence),
      esc(v.instructor_certificate),
      esc(v.restriction),
      esc(transmission),
    ].join(',');
  });
  fs.writeFileSync(filepath, header + lines.join('\n'), 'utf8');

  const bookNo = rows[0].book_no;
  const atbNo = rows[0].atb_no;
  const subject = `ATB Number ${atbNo} : DL196 Returns for Certificates Numbers ${firstCert} - ${lastCert} (Book ${bookNo})`;
  const html = `Dear Sir / Madam,<br/><br/>Please find enclosed the digital DL196 Return for Certificate numbers ${firstCert} - ${lastCert} in a .csv format.<br/><br/>Kind Regards<br/>1 Stop Instruction`;
  const mailType = resend === 0 ? 'DL196 Returns' : 'Re-sent DL196 Returns';

  let emailStatus = 0;
  let emailError = '';
  try {
    await mailTransporter.sendMail({
      from: getMailFrom(),
      to: recipient,
      bcc: 'info@1stopinstruction.com',
      subject,
      html,
      attachments: [{ filename, path: filepath }],
    });
    emailStatus = 1;
  } catch (mailErr) {
    emailError = mailErr?.message || String(mailErr);
    const err = new Error(`Message could not be sent. ${emailError}`);
    err.code = 'MAIL_FAILED';
    throw err;
  } finally {
    try {
      await pool.query(
        `INSERT INTO email_logs (book_ref, \`to\`, cc, bcc, \`from\`, subject, email_content, email_by, status, created, type, error)
         VALUES (?, ?, '', ?, ?, ?, ?, 't', ?, ?, ?, ?)`,
        [
          '',
          recipient,
          'info@1stopinstruction.com',
          getMailFromAddress(),
          subject,
          html.replace(/'/g, "\\'"),
          emailStatus,
          nowMysql(),
          mailType,
          emailError,
        ]
      );
    } catch (logErr) {
      console.error('[ADMIN][DL][EXPORT][LOG]', logErr.message);
    }
  }

  const ts = nowMysql();
  await pool.query('UPDATE dl_returns SET exported_on = ?, is_sent = 1 WHERE id = ?', [
    ts,
    id,
  ]);

  return { message: 'DL Book CSV created', exported_on: ts };
}

async function getInstructorsForDl(pool) {
  const [rows] = await pool.query(
    `SELECT id, CONCAT(fname, ' ', lname, ' --- ', instructor_certificate_number) AS label,
      instructor_certificate_number
     FROM itineraries WHERE status = 1 ORDER BY fname, lname`
  );
  return rows.map((r) => ({
    id: Number(r.id),
    label: r.label || '',
    instructor_certificate_number: r.instructor_certificate_number || '',
  }));
}

async function getCertificateEditContext(pool, certificateId) {
  const certId = Number(certificateId);
  const [rows] = await pool.query(
    `SELECT dl.id AS book_id, dl.location_id, dl.course_id, dl.book_no, dl.is_locked AS book_locked,
      dlc.*
     FROM dl_return_certificates dlc
     JOIN dl_returns dl ON dl.id = dlc.dl_return_id
     WHERE dlc.id = ? LIMIT 1`,
    [certId]
  );
  const row = rows[0];
  if (!row) return null;
  if (Number(row.book_locked) === 1) {
    const err = new Error(
      'This Book is locked. Please unlock this book to edit certificate'
    );
    err.code = 'BOOK_LOCKED';
    err.book_id = Number(row.book_id);
    throw err;
  }
  const [allCerts] = await pool.query(
    'SELECT id, certificate_no FROM dl_return_certificates WHERE dl_return_id = ? ORDER BY certificate_no ASC',
    [row.book_id]
  );
  const [locationRows] = await pool.query(
    'SELECT location_name FROM locations WHERE id = ? LIMIT 1',
    [row.location_id]
  );
  const instructors = await getInstructorsForDl(pool);
  return {
    certificate: {
      ...row,
      completion_date: normalizeCompletionDate(row.completion_date),
    },
    book: {
      id: Number(row.book_id),
      book_no: row.book_no,
      location_id: Number(row.location_id),
      course_id: Number(row.course_id),
      location_name: locationRows[0]?.location_name || '',
    },
    all_certificates: allCerts.map((c) => ({
      id: Number(c.id),
      certificate_no: c.certificate_no,
    })),
    instructors,
    vehicle_types: Object.entries(VEHICLE_TYPE_LABELS).map(([value, label]) => ({
      value: String(value),
      label,
    })),
  };
}

function mapAttendeeRows(attendees) {
  return attendees.map((a) => {
    const licence = a.license_number || '';
    const ddVal = licence ? a.attendee_name : `${a.attendee_name}_0`;
    return {
      attendee_id: Number(a.attendee_id),
      attendee_name: a.attendee_name || '',
      license_number: licence,
      vehicle_type: a.vehicle_type,
      driver_value: ddVal,
      label: `${a.attendee_name} --- ${licence || 'NA'}`,
    };
  });
}

async function fetchAttendeesForLocationCourseDate(pool, locationId, courseId, completionDate) {
  const mysqlDate = toMysqlDate(completionDate);
  if (!mysqlDate || !locationId || !courseId) {
    return { attendees: [], course_event_id: 0, course_start_time: '', course_events: [] };
  }

  const [events] = await pool.query(
    `SELECT course_event_dates.course_event_id, course_event_dates.event_start_time
     FROM course_event_dates
     LEFT JOIN course_events ON course_events.id = course_event_dates.course_event_id
     WHERE course_event_dates.event_date = ?
       AND course_events.location_id = ?
       AND course_events.course_id = ?`,
    [mysqlDate, locationId, courseId]
  );
  if (!events.length) {
    return { attendees: [], course_event_id: 0, course_start_time: '', course_events: events };
  }
  const eventIds = events.map((e) => e.course_event_id);
  const placeholders = eventIds.map(() => '?').join(',');
  const [attendees] = await pool.query(
    `SELECT booking_attendees.id AS attendee_id,
      CONCAT(booking_attendees.first_name, ' ', booking_attendees.sur_name) AS attendee_name,
      booking_attendees.license_number,
      booking_attendees.vehicle_type
     FROM bookings
     LEFT JOIN booking_attendees ON bookings.id = booking_attendees.booking_id
     WHERE bookings.course_event_id IN (${placeholders}) AND bookings.status = 1`,
    eventIds
  );
  return {
    attendees: mapAttendeeRows(attendees),
    course_event_id: Number(events[0].course_event_id) || 0,
    course_start_time: events[0].event_start_time || '',
    course_events: events,
  };
}

async function getCertificateAttendees(pool, certificateId, completionDate) {
  const certId = Number(certificateId);
  const [certRows] = await pool.query(
    `SELECT dlc.*, dl.location_id, dl.course_id
     FROM dl_return_certificates dlc
     JOIN dl_returns dl ON dl.id = dlc.dl_return_id
     WHERE dlc.id = ? LIMIT 1`,
    [certId]
  );
  const cert = certRows[0];
  if (!cert) return { attendees: [], course_event_id: 0, course_start_time: '', course_events: [] };

  return fetchAttendeesForLocationCourseDate(
    pool,
    cert.location_id,
    cert.course_id,
    completionDate ?? cert.completion_date
  );
}

async function getAttendeesForBookDate(pool, bookId, completionDate) {
  const id = Number(bookId);
  const [bookRows] = await pool.query(
    'SELECT location_id, course_id FROM dl_returns WHERE id = ? LIMIT 1',
    [id]
  );
  const book = bookRows[0];
  if (!book) {
    return { attendees: [], course_event_id: 0, course_start_time: '', course_events: [] };
  }
  return fetchAttendeesForLocationCourseDate(
    pool,
    book.location_id,
    book.course_id,
    completionDate
  );
}

async function resolveCourseStartTime(pool, locationId, courseId, selDate, attendee) {
  const mysqlDate = toMysqlDate(selDate);
  if (!mysqlDate || !locationId || !courseId) {
    return { course_event_id: 0, course_start_time: '' };
  }

  const [events] = await pool.query(
    `SELECT course_event_dates.course_event_id, course_event_dates.event_start_time
     FROM course_event_dates
     LEFT JOIN course_events ON course_events.id = course_event_dates.course_event_id
     WHERE course_event_dates.event_date = ?
       AND course_events.location_id = ?
       AND course_events.course_id = ?`,
    [mysqlDate, locationId, courseId]
  );
  if (!events.length) return { course_event_id: 0, course_start_time: '' };

  if (events.length === 1) {
    return {
      course_event_id: Number(events[0].course_event_id) || 0,
      course_start_time: events[0].event_start_time || '',
    };
  }

  const eventIds = events.map((e) => e.course_event_id);
  const timeByEvent = Object.fromEntries(
    events.map((e) => [String(e.course_event_id), e.event_start_time])
  );
  const placeholders = eventIds.map(() => '?').join(',');
  const attendeeName = trim(attendee).replace(/_0$/, '');
  const [match] = await pool.query(
    `SELECT bookings.course_event_id
     FROM bookings
     LEFT JOIN booking_attendees ON bookings.id = booking_attendees.booking_id
     WHERE bookings.course_event_id IN (${placeholders})
       AND bookings.status = 1
       AND CONCAT(booking_attendees.first_name, ' ', booking_attendees.sur_name) = ?
     LIMIT 1`,
    [...eventIds, attendeeName]
  );
  if (!match[0]) {
    return {
      course_event_id: Number(events[0].course_event_id) || 0,
      course_start_time: events[0].event_start_time || '',
    };
  }
  const ceId = String(match[0].course_event_id);
  return {
    course_event_id: Number(match[0].course_event_id) || 0,
    course_start_time: timeByEvent[ceId] || '',
  };
}

async function getCourseEventStartTime(pool, certificateId, selDate, attendee) {
  const certId = Number(certificateId);
  const [certRows] = await pool.query(
    `SELECT dl.location_id, dl.course_id
     FROM dl_return_certificates dlc
     JOIN dl_returns dl ON dl.id = dlc.dl_return_id
     WHERE dlc.id = ? LIMIT 1`,
    [certId]
  );
  const cert = certRows[0];
  if (!cert) return { course_event_id: 0, course_start_time: '' };
  return resolveCourseStartTime(
    pool,
    cert.location_id,
    cert.course_id,
    selDate,
    attendee
  );
}

async function getCourseEventStartTimeForBook(pool, bookId, selDate, attendee) {
  const id = Number(bookId);
  const [bookRows] = await pool.query(
    'SELECT location_id, course_id FROM dl_returns WHERE id = ? LIMIT 1',
    [id]
  );
  const book = bookRows[0];
  if (!book) return { course_event_id: 0, course_start_time: '' };
  return resolveCourseStartTime(
    pool,
    book.location_id,
    book.course_id,
    selDate,
    attendee
  );
}

async function checkBookNoAvailability(pool, bookNo, mode = 'add', excludeId = 0) {
  const exists = await checkBookNoExists(
    pool,
    bookNo,
    mode === 'edit' ? Number(excludeId) : 0
  );
  return { cnt: exists ? 1 : 0 };
}

async function lookupCertificateByNumber(pool, certificateNo) {
  const certNum = trim(certificateNo);
  if (!certNum) {
    const err = new Error('Certificate number required');
    err.code = 'VALIDATION';
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT dl.id, dlc.id AS dlc_id, dl.location_id, dl.course_id, dl.book_no, dl.is_locked,
      dlc.course_event_id, dlc.atb_no, dlc.certificate_no, dlc.completion_date, dlc.start_time,
      dlc.completion_time, dlc.duration, dlc.attendee_id, dlc.attendee_name, dlc.attendee_licence,
      dlc.instructor_id, dlc.instructor_certificate, dlc.restriction, dlc.transmission,
      dlc.certificate_voided, dlc.duplicate_certificate
     FROM dl_returns AS dl
     LEFT JOIN dl_return_certificates AS dlc ON dl.id = dlc.dl_return_id
     WHERE dlc.certificate_no = ?
     LIMIT 1`,
    [certNum]
  );
  if (!rows[0]?.dlc_id) {
    const err = new Error(
      'The certificate number you searched could not be found.  Please check again.'
    );
    err.code = 'NOT_FOUND';
    throw err;
  }

  const row = rows[0];
  const attendeeBundle = await fetchAttendeesForLocationCourseDate(
    pool,
    row.location_id,
    row.course_id,
    row.completion_date
  );
  const instructors = await getInstructorsForDl(pool);

  return {
    certificate: row,
    attendees: attendeeBundle.attendees,
    instructors,
  };
}

async function syncAttendeeLicenceAfterCertEdit(pool, attendeeId, attendeeLicence) {
  const aid = Number(attendeeId);
  const licence = trim(attendeeLicence).toUpperCase();
  if (!aid || !licence) return;

  const [userRows] = await pool.query(
    'SELECT * FROM booking_attendees WHERE id = ? LIMIT 1',
    [aid]
  );
  const user = userRows[0];
  if (!user) return;

  await pool.query('UPDATE booking_attendees SET license_number = ? WHERE id = ?', [
    licence,
    aid,
  ]);

  if (user.contact_card_id) {
    const [recCheck] = await pool.query(
      'SELECT * FROM booking_attendees_dropdown WHERE id = ? LIMIT 1',
      [user.contact_card_id]
    );
    if (recCheck[0]) {
      const [recByLicence] = await pool.query(
        'SELECT id FROM booking_attendees_dropdown WHERE license_number = ? LIMIT 1',
        [licence]
      );
      const targetId = recByLicence[0]?.id || recCheck[0].id;
      await pool.query(
        'UPDATE booking_attendees_dropdown SET license_number = ? WHERE id = ?',
        [licence, targetId]
      );
    }
  }

  const [bookingRows] = await pool.query(
    'SELECT course_event_id FROM bookings WHERE id = ? LIMIT 1',
    [user.booking_id]
  );
  const [eventDateRows] = await pool.query(
    'SELECT event_date FROM course_event_dates WHERE course_event_id = ? LIMIT 1',
    [bookingRows[0]?.course_event_id]
  );
  const eventDate = eventDateRows[0]?.event_date;
  if (!eventDate || !user.contact_card_id) return;

  const [futureAttendees] = await pool.query(
    `SELECT booking_attendees.id AS baid, booking_attendees.license_number
     FROM bookings
     LEFT JOIN booking_attendees ON booking_attendees.booking_id = bookings.id
     LEFT JOIN courses ON bookings.course_id = courses.id
     LEFT JOIN course_events ON bookings.course_event_id = course_events.id
     LEFT JOIN course_event_dates ON course_event_dates.course_event_id = course_events.id
     WHERE (bookings.status != 5 OR bookings.status IS NULL)
       AND booking_attendees.contact_card_id > 0
       AND booking_attendees.contact_card_id = ?
       AND booking_attendees.id <> ?
       AND course_event_dates.event_date >= ?
     ORDER BY bookings.id DESC`,
    [user.contact_card_id, aid, eventDate]
  );
  const updateIds = futureAttendees
    .filter((v) => trim(v.license_number))
    .map((v) => v.baid);
  if (updateIds.length) {
    await pool.query(
      `UPDATE booking_attendees SET license_number = ? WHERE id IN (${updateIds.map(() => '?').join(',')})`,
      [licence, ...updateIds]
    );
  }
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
    `SELECT dlc.*, dl.is_locked AS book_locked
     FROM dl_return_certificates dlc
     JOIN dl_returns dl ON dl.id = dlc.dl_return_id
     WHERE dlc.id = ? LIMIT 1`,
    [certId]
  );
  const cert = rows[0];
  if (!cert) {
    const err = new Error('Certificate not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (Number(cert.book_locked) === 1) {
    const err = new Error(
      'This Book is locked. Please unlock this book to edit certificate'
    );
    err.code = 'BOOK_LOCKED';
    err.book_id = Number(cert.dl_return_id);
    throw err;
  }

  const ts = nowMysql();
  const updatedByName = `${session?.admin_fristname || ''} ${session?.admin_lastname || ''}`.trim();
  const updatedById = Number(session?.loggedinAdmin?.admin_id) || 0;

  let attendeeName = trim(body.attendee_name ?? body.driver);
  if (attendeeName.includes('_0')) {
    attendeeName = attendeeName.split('_0')[0];
  }
  const attendeeLicence = trim(body.attendee_licence ?? body.driver_licence).toUpperCase();
  const certificateVoided = body.certificate_voided === 'yes' ? 'yes' : 'no';
  const duplicateCertificate = body.duplicate_certificate === 'yes' ? 'yes' : 'no';
  let restriction = trim(body.restriction ?? body.ristriction);
  if (certificateVoided === 'yes') restriction = 'VOID';

  let instructorId = Number(body.instructor_id) || 0;
  if (!instructorId && body.instructor_certificate != null) {
    const rawIns = trim(body.instructor_certificate);
    if (/^\d+$/.test(rawIns)) instructorId = Number(rawIns);
  }
  let instructorCertificate = trim(body.instructor_certificate_number);
  if (instructorId) {
    const [insRows] = await pool.query(
      'SELECT instructor_certificate_number FROM itineraries WHERE id = ? LIMIT 1',
      [instructorId]
    );
    instructorCertificate = insRows[0]?.instructor_certificate_number || instructorCertificate;
  }

  const attendeeId = Number(body.attendee_id) || 0;
  const courseEventId = Number(body.course_event_id) || 0;

  if (
    certificateVoided !== 'yes' &&
    (attendeeName || attendeeLicence) &&
    !body.licence_validation_override
  ) {
    assertDl196LicenceValid(attendeeLicence, { label: 'Driving licence' });
  }

  await pool.query(
    `UPDATE dl_return_certificates SET
      course_event_id = ?, completion_date = ?, start_time = ?, completion_time = ?, duration = ?,
      attendee_name = ?, attendee_licence = ?, instructor_id = ?, instructor_certificate = ?,
      restriction = ?, transmission = ?,
      certificate_voided = ?, duplicate_certificate = ?,
      updated = ?, updated_by = 'admin', updated_by_name = ?, updated_by_id = ?, attendee_id = ?
     WHERE id = ?`,
    [
      courseEventId,
      toMysqlDate(body.completion_date ?? body.complition_date),
      trim(body.start_time),
      trim(body.completion_time ?? body.complition_time),
      Number(body.duration ?? body.course_duration) || 0,
      attendeeName,
      attendeeLicence,
      instructorId,
      instructorCertificate,
      restriction,
      trim(body.transmission),
      certificateVoided,
      duplicateCertificate,
      ts,
      updatedByName,
      updatedById,
      attendeeId,
      certId,
    ]
  );

  if (attendeeId > 0 && attendeeLicence) {
    await syncAttendeeLicenceAfterCertEdit(pool, attendeeId, attendeeLicence);
  }

  return getDlCertificate(pool, certId);
}

function normalizeAttendeeNameFromDriver(driver) {
  let attendeeName = trim(driver);
  if (attendeeName.includes('_0')) attendeeName = attendeeName.split('_0')[0];
  return attendeeName;
}

function dl196RowHasAttendeeData(val) {
  const driver = trim(val?.driver);
  const licence = trim(val?.driver_licence);
  return Boolean(driver || licence);
}

function assertDl196LicenceValid(licence, { override = false, label = '' } = {}) {
  if (override) return;
  const check = validateDrivingLicenceNumber(licence, { required: true });
  if (!check.valid) {
    const err = new Error(
      `${label ? `${label}: ` : ''}${check.message || 'Driving licence number is not valid'}`
    );
    err.code = 'LICENCE_VALIDATION';
    throw err;
  }
}

function certSnapshotFromDb(c) {
  return {
    course_event_id: Number(c.course_event_id) || 0,
    completion_date: normalizeCompletionDate(c.completion_date),
    start_time: trim(c.start_time),
    completion_time: trim(c.completion_time),
    duration: Number(c.duration) || 0,
    attendee_name: trim(c.attendee_name),
    attendee_licence: trim(c.attendee_licence).toUpperCase(),
    instructor_id: Number(c.instructor_id) || 0,
    restriction: trim(c.restriction),
    transmission:
      c.transmission === null || c.transmission === undefined
        ? ''
        : String(c.transmission),
    attendee_id: Number(c.attendee_id) || 0,
  };
}

function certSnapshotFromInput(val) {
  return {
    course_event_id: Number(val.course_event_id) || 0,
    completion_date: toMysqlDate(val.complition_date),
    start_time: trim(val.start_time),
    completion_time: trim(val.complition_time),
    duration: Number(val.course_duration) || 0,
    attendee_name: normalizeAttendeeNameFromDriver(val.driver),
    attendee_licence: trim(val.driver_licence).toUpperCase(),
    instructor_id: Number(val.instructor_certificate) || 0,
    restriction: trim(val.ristriction),
    transmission: trim(val.transmission),
    attendee_id: Number(val.attendee_id) || 0,
  };
}

function certDataChanged(prev, next) {
  return JSON.stringify(prev) !== JSON.stringify(next);
}

async function resolveInstructorCertificate(pool, instructorId) {
  if (!instructorId) return '';
  const [insRows] = await pool.query(
    'SELECT instructor_certificate_number FROM itineraries WHERE id = ? LIMIT 1',
    [instructorId]
  );
  return insRows[0]?.instructor_certificate_number || '';
}

async function bulkMultiEditCertificates(pool, bookId, body, session) {
  const id = Number(bookId);
  const [bookRows] = await pool.query('SELECT * FROM dl_returns WHERE id = ?', [id]);
  const book = bookRows[0];
  if (!book) {
    const err = new Error('Data not found to edit');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (Number(book.is_locked) === 1) {
    const err = new Error(
      'This Book is locked. Please unlock this book to edit certificate'
    );
    err.code = 'BOOK_LOCKED';
    err.book_id = id;
    throw err;
  }

  const bookNo = trim(body.book_no) || book.book_no;
  const firstCert = Number(body.first_cbt_certificate ?? book.starting_certificate);
  const rows = Array.isArray(body.certificate) ? body.certificate : [];
  const licenceOverride = Boolean(body.licence_validation_override);
  const ts = nowMysql();
  const updatedByName = `${session?.admin_fristname || ''} ${session?.admin_lastname || ''}`.trim();
  const updatedById = Number(session?.loggedinAdmin?.admin_id) || 0;
  const atbNo = book.atb_no;

  const [existingRows] = await pool.query(
    `SELECT * FROM dl_return_certificates WHERE dl_return_id = ? ORDER BY certificate_no ASC`,
    [id]
  );
  const existingById = new Map(
    existingRows.map((row) => [Number(row.id), row])
  );

  for (let k = 0; k < rows.length; k += 1) {
    const val = rows[k] || {};
    if (!dl196RowHasAttendeeData(val)) continue;
    assertDl196LicenceValid(trim(val.driver_licence).toUpperCase(), {
      override: licenceOverride,
      label: `Certificate #${k + 1}`,
    });
  }

  for (let k = 0; k < rows.length; k += 1) {
    const val = rows[k] || {};
    const certNo = firstCert + k;
    const nextSnapshot = certSnapshotFromInput(val);
    const certId = Number(val.id) || 0;
    const prev = certId ? existingById.get(certId) : existingRows[k];
    const prevSnapshot = prev ? certSnapshotFromDb(prev) : null;
    const changed = !prevSnapshot || certDataChanged(prevSnapshot, nextSnapshot);
    const instructorId = nextSnapshot.instructor_id;
    const instructorCertificate = await resolveInstructorCertificate(pool, instructorId);

    if (prev?.id) {
      await pool.query(
        `UPDATE dl_return_certificates SET
          course_event_id = ?, book_no = ?, atb_no = ?, certificate_no = ?,
          completion_date = ?, start_time = ?, completion_time = ?, duration = ?,
          attendee_name = ?, attendee_licence = ?, instructor_id = ?, instructor_certificate = ?,
          restriction = ?, transmission = ?, attendee_id = ?,
          updated = ?, updated_by = ?, updated_by_name = ?, updated_by_id = ?
         WHERE id = ?`,
        [
          nextSnapshot.course_event_id,
          bookNo,
          atbNo,
          certNo,
          nextSnapshot.completion_date,
          nextSnapshot.start_time,
          nextSnapshot.completion_time,
          nextSnapshot.duration,
          nextSnapshot.attendee_name,
          nextSnapshot.attendee_licence,
          instructorId,
          instructorCertificate,
          nextSnapshot.restriction,
          nextSnapshot.transmission,
          nextSnapshot.attendee_id,
          changed ? ts : prev.updated,
          changed ? 'admin' : prev.updated_by || 'admin',
          changed ? updatedByName : prev.updated_by_name || '',
          changed ? updatedById : Number(prev.updated_by_id) || 0,
          prev.id,
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO dl_return_certificates (
          dl_return_id, course_event_id, book_no, atb_no, certificate_no,
          completion_date, start_time, completion_time, duration,
          attendee_name, attendee_licence, instructor_id, instructor_certificate,
          restriction, transmission, created, updated, updated_by, updated_by_name, updated_by_id, attendee_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          nextSnapshot.course_event_id,
          bookNo,
          atbNo,
          certNo,
          nextSnapshot.completion_date,
          nextSnapshot.start_time,
          nextSnapshot.completion_time,
          nextSnapshot.duration,
          nextSnapshot.attendee_name,
          nextSnapshot.attendee_licence,
          instructorId,
          instructorCertificate,
          nextSnapshot.restriction,
          nextSnapshot.transmission,
          ts,
          ts,
          'admin',
          updatedByName,
          updatedById,
          nextSnapshot.attendee_id,
        ]
      );
    }

    if (nextSnapshot.attendee_id > 0 && nextSnapshot.attendee_licence) {
      await syncAttendeeLicenceAfterCertEdit(
        pool,
        nextSnapshot.attendee_id,
        nextSnapshot.attendee_licence
      );
    }
  }

  if (trim(body.book_no) && trim(body.book_no) !== trim(book.book_no)) {
    await pool.query('UPDATE dl_returns SET book_no = ? WHERE id = ?', [bookNo, id]);
  }
  if (
    body.first_cbt_certificate != null &&
    Number(body.first_cbt_certificate) !== Number(book.starting_certificate)
  ) {
    await pool.query('UPDATE dl_returns SET starting_certificate = ? WHERE id = ?', [
      firstCert,
      id,
    ]);
  }

  return getDlReturnBook(pool, id);
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
  listDlBooksByLocation,
  toggleDlReturnLock,
  resetDlReturnCertificate,
  updateDlReturnBookDetails,
  exportDlReturnBook,
  getCertificateEditContext,
  getCertificateAttendees,
  getAttendeesForBookDate,
  getCourseEventStartTime,
  getCourseEventStartTimeForBook,
  checkBookNoAvailability,
  lookupCertificateByNumber,
  getInstructorsForDl,
  bulkMultiEditCertificates,
};
