/**
 * Admin DL196 returns — port of dl_returns*.php
 */
const nodemailer = require('nodemailer');
const { getMailFrom } = require('../../utils/mailFrom');

const RECORDS_PER_PAGE = 10;
const CERTS_PER_BOOK = 25;
const VEHICLE_TYPE = { 0: 'Manual', 1: 'Automatic', 3: 'Own vehicle' };

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function toDateOrEmpty(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()) || value.getFullYear() < 1900) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  const raw = trim(value);
  if (!raw || raw.startsWith('0000-00-00')) return '';
  const uk = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`;
  return raw.slice(0, 10);
}

function mysqlDate(value) {
  return toDateOrEmpty(value) || '0000-00-00';
}

function adminName(session) {
  return `${trim(session?.admin_fristname)} ${trim(session?.admin_lastname)}`.trim() || 'Admin';
}

function adminId(session) {
  return Number(session?.loggedinAdmin?.admin_id) || 0;
}

async function getDlFormOptions(pool, locationId = 0) {
  const [locations] = await pool.query(
    `SELECT id, location_name FROM locations WHERE show_in_dl_return = 1 ORDER BY location_name ASC`
  );
  const [franchises] = await pool.query(
    `SELECT id, atb_number, franchise_name FROM franchise
     WHERE status = '1' AND isDeleted = '0' ORDER BY franchise_name ASC`
  );
  const locId = Number(locationId) || 0;
  let courses = [];
  if (locId > 0) {
    const [rows] = await pool.query(
      `SELECT DISTINCT c.id, c.course_name
       FROM courses c
       JOIN course_events ce ON c.id = ce.course_id
       WHERE c.is_cbt = 1 AND ce.status = '1' AND c.status IN ('1','2')
         AND ce.location_id = ?
       ORDER BY c.course_name ASC`,
      [locId]
    );
    courses = rows || [];
  }
  const [instructors] = await pool.query(
    `SELECT id, CONCAT(fname, ' ', lname, ' --- ', instructor_certificate_number) AS ins_val,
            fname, lname, instructor_certificate_number
     FROM itineraries WHERE status = 1 ORDER BY fname ASC, lname ASC`
  );
  return {
    locations: (locations || []).map((l) => ({
      id: Number(l.id),
      label: l.location_name,
    })),
    franchises: (franchises || []).map((f) => ({
      id: Number(f.id),
      atb_number: f.atb_number || '',
      label: `${f.franchise_name}${f.atb_number ? ` (${f.atb_number})` : ''}`,
    })),
    courses: (courses || []).map((c) => ({
      id: Number(c.id),
      label: c.course_name,
    })),
    instructors: (instructors || []).map((i) => ({
      id: Number(i.id),
      label: i.ins_val,
      certificate: i.instructor_certificate_number || '',
    })),
    certificateStatuses: [
      { value: 'At-Office', label: 'At Office' },
      { value: 'On-Site', label: 'On Site' },
    ],
  };
}

async function listDlReturns(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const params = [];
  let where = 'WHERE 1 = 1 ';
  if (trim(searchterm.book_scr)) {
    where += ' AND dl.book_no LIKE ? ';
    params.push(trim(searchterm.book_scr));
  }
  if (trim(searchterm.date_scr)) {
    where += ' AND dlc.completion_date = ? ';
    params.push(toDateOrEmpty(searchterm.date_scr) || searchterm.date_scr);
  }
  if (trim(searchterm.cert_scr)) {
    where += ' AND dlc.certificate_no LIKE ? ';
    params.push(trim(searchterm.cert_scr));
  }
  if (trim(searchterm.loc_scr)) {
    where += ' AND dl.location_id LIKE ? ';
    params.push(trim(searchterm.loc_scr));
  }
  if (trim(searchterm.lock_scr) !== '') {
    where += ' AND dl.is_locked LIKE ? ';
    params.push(trim(searchterm.lock_scr));
  }
  if (trim(searchterm.pupname_scr)) {
    where += ' AND dlc.attendee_name LIKE ? ';
    params.push(`%${trim(searchterm.pupname_scr)}%`);
  }
  if (trim(searchterm.licence_scr)) {
    where += ' AND dlc.attendee_licence LIKE ? ';
    params.push(`%${trim(searchterm.licence_scr)}%`);
  }
  if (trim(searchterm.certificate_src)) {
    where += ' AND dl.certificate_status LIKE ? ';
    params.push(`%${trim(searchterm.certificate_src)}%`);
  }

  const from = `
    FROM dl_returns AS dl
    LEFT JOIN dl_return_certificates AS dlc ON dl.id = dlc.dl_return_id
    LEFT JOIN locations ON locations.id = dl.location_id
    ${where}
    GROUP BY dl.book_no
  `;

  const [countRows] = await pool.query(
    `SELECT dl.id ${from}`,
    params
  );
  const total = (countRows || []).length;
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const [rows] = await pool.query(
    `SELECT dl.id, dl.certificate_status, dl.location_id, dl.book_no,
            MIN(dlc.certificate_no) AS min_certificate_no,
            MAX(dlc.certificate_no) AS max_certificate_no,
            GROUP_CONCAT(DATE_FORMAT(dlc.completion_date, '%d-%m-%Y') ORDER BY dlc.id) AS comp_date,
            dl.is_locked, dl.exported_on, dl.is_sent, locations.location_name
     ${from}
     ORDER BY ABS(dl.book_no) DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  const formOptions = await getDlFormOptions(pool);

  return {
    items: (rows || []).map((r) => ({
      id: Number(r.id),
      book_no: r.book_no,
      location_id: Number(r.location_id) || 0,
      location_name: r.location_name || '',
      certificate_status: r.certificate_status,
      min_certificate_no: r.min_certificate_no,
      max_certificate_no: r.max_certificate_no,
      comp_date: r.comp_date || '',
      is_locked: Number(r.is_locked) || 0,
      is_sent: Number(r.is_sent) || 0,
      exported_on: r.exported_on,
    })),
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE) || 1),
    },
    filters: {
      book_scr: trim(searchterm.book_scr),
      date_scr: trim(searchterm.date_scr),
      cert_scr: trim(searchterm.cert_scr),
      loc_scr: trim(searchterm.loc_scr),
      lock_scr: trim(searchterm.lock_scr),
      pupname_scr: trim(searchterm.pupname_scr),
      licence_scr: trim(searchterm.licence_scr),
      certificate_src: trim(searchterm.certificate_src),
    },
    formOptions,
  };
}

async function createDlBook(pool, body, session) {
  const location_id = Number(body.location_id) || 0;
  const course_id = Number(body.course_id) || 0;
  const book_no = trim(body.book_no);
  const first = Number(body.first_cbt_certificate || body.starting_certificate);
  const certificate_status =
    trim(body.certificate_status) === 'On-Site' ? 'On-Site' : 'At-Office';
  const atb_no = trim(body.atb_no);

  if (!location_id || !course_id || !book_no || !first || !atb_no) {
    return { ok: false, message: 'Required fields can not be left blank' };
  }
  if (!/^\d+$/.test(book_no)) {
    return { ok: false, message: 'Book No must be a number' };
  }
  if (!Number.isFinite(first)) {
    return { ok: false, message: 'Certificate No must be a number' };
  }
  const [dup] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM dl_returns WHERE book_no = ?',
    [book_no]
  );
  if (Number(dup?.[0]?.cnt) > 0) {
    return { ok: false, message: 'Book No is already exists' };
  }

  const created = nowMysql();
  const [ins] = await pool.query(
    `INSERT INTO dl_returns
       (location_id, course_id, book_no, starting_certificate, certificate_status,
        atb_no, is_locked, is_sent, created)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    [location_id, course_id, book_no, first, certificate_status, atb_no, created]
  );
  const bookId = ins.insertId;
  const name = adminName(session);
  const uid = adminId(session);

  for (let cer = first; cer < first + CERTS_PER_BOOK; cer += 1) {
    await pool.query(
      `INSERT INTO dl_return_certificates (
         dl_return_id, course_event_id, book_no, atb_no, certificate_no,
         completion_date, start_time, completion_time, duration,
         attendee_id, attendee_name, attendee_licence,
         instructor_id, instructor_certificate, restriction, transmission,
         updated_by, updated_by_name, updated_by_id, is_locked,
         certificate_voided, duplicate_certificate, created, updated
       ) VALUES (?, 0, ?, ?, ?, '0000-00-00', '', '', 0, 0, '', '', 0, '', '', '',
                 'admin', ?, ?, 0, 'no', 'no', ?, ?)`,
      [bookId, book_no, atb_no, cer, name, uid, created, created]
    );
  }

  return {
    ok: true,
    message: 'DL196 Return Book created successfully',
    data: { id: bookId },
  };
}

function mapCert(row) {
  return {
    id: Number(row.id),
    dl_return_id: Number(row.dl_return_id),
    course_event_id: Number(row.course_event_id) || 0,
    book_no: row.book_no,
    atb_no: row.atb_no,
    certificate_no: row.certificate_no,
    completion_date: toDateOrEmpty(row.completion_date),
    start_time: row.start_time || '',
    completion_time: row.completion_time || '',
    duration: Number(row.duration) || 0,
    attendee_id: Number(row.attendee_id) || 0,
    attendee_name: row.attendee_name || '',
    attendee_licence: row.attendee_licence || '',
    instructor_id: Number(row.instructor_id) || 0,
    instructor_certificate: row.instructor_certificate || '',
    restriction: row.restriction || '',
    transmission: row.transmission || '',
    certificate_voided: row.certificate_voided || 'no',
    duplicate_certificate: row.duplicate_certificate || 'no',
    updated_by_name: row.updated_by_name || '',
    updated: row.updated,
  };
}

async function getDlBook(pool, id) {
  const bookId = Number(id);
  if (!bookId) return null;
  const [books] = await pool.query(
    'SELECT * FROM dl_returns WHERE id = ? LIMIT 1',
    [bookId]
  );
  const book = books?.[0];
  if (!book) return null;
  const [certs] = await pool.query(
    `SELECT * FROM dl_return_certificates WHERE dl_return_id = ? ORDER BY certificate_no ASC`,
    [bookId]
  );
  const formOptions = await getDlFormOptions(pool, book.location_id);
  return {
    book: {
      id: Number(book.id),
      location_id: Number(book.location_id),
      course_id: Number(book.course_id),
      book_no: book.book_no,
      starting_certificate: book.starting_certificate,
      certificate_status: book.certificate_status,
      atb_no: book.atb_no,
      is_locked: Number(book.is_locked) || 0,
      is_sent: Number(book.is_sent) || 0,
      exported_on: book.exported_on,
      created: book.created,
    },
    certificates: (certs || []).map(mapCert),
    formOptions,
  };
}

async function getCertificate(pool, id) {
  const cid = Number(id);
  const [rows] = await pool.query(
    'SELECT * FROM dl_return_certificates WHERE id = ? LIMIT 1',
    [cid]
  );
  const cert = rows?.[0];
  if (!cert) return null;
  const data = await getDlBook(pool, cert.dl_return_id);
  return {
    certificate: mapCert(cert),
    book: data?.book || null,
    formOptions: data?.formOptions || {},
  };
}

async function updateCertificate(pool, id, body, session) {
  const cid = Number(id);
  const existing = await getCertificate(pool, cid);
  if (!existing) return { ok: false, message: 'Certificate not found' };

  let instructor_id = Number(body.instructor_id || body.instructor_certificate) || 0;
  let instructor_certificate = trim(body.instructor_certificate_number);
  if (instructor_id > 0 && !instructor_certificate) {
    const [ins] = await pool.query(
      'SELECT instructor_certificate_number FROM itineraries WHERE id = ? LIMIT 1',
      [instructor_id]
    );
    instructor_certificate = trim(ins?.[0]?.instructor_certificate_number);
  }

  await pool.query(
    `UPDATE dl_return_certificates SET
       course_event_id = ?, completion_date = ?, start_time = ?, completion_time = ?,
       duration = ?, attendee_id = ?, attendee_name = ?, attendee_licence = ?,
       instructor_id = ?, instructor_certificate = ?, restriction = ?, transmission = ?,
       certificate_voided = ?, duplicate_certificate = ?,
       updated = ?, updated_by = 'admin', updated_by_name = ?, updated_by_id = ?
     WHERE id = ?`,
    [
      Number(body.course_event_id) || 0,
      mysqlDate(body.completion_date),
      trim(body.start_time),
      trim(body.completion_time),
      Number(body.duration) || 0,
      Number(body.attendee_id) || 0,
      trim(body.attendee_name),
      trim(body.attendee_licence),
      instructor_id,
      instructor_certificate,
      trim(body.restriction),
      trim(body.transmission),
      trim(body.certificate_voided) === 'yes' ? 'yes' : 'no',
      trim(body.duplicate_certificate) === 'yes' ? 'yes' : 'no',
      nowMysql(),
      adminName(session),
      adminId(session),
      cid,
    ]
  );
  return { ok: true, message: 'Certificate updated successfully' };
}

async function resetCertificate(pool, id, session) {
  const cid = Number(id);
  await pool.query(
    `UPDATE dl_return_certificates SET
       course_event_id = 0, completion_date = '0000-00-00', start_time = '',
       completion_time = '', duration = 0, attendee_name = '', attendee_licence = '',
       instructor_id = 0, instructor_certificate = '', restriction = '', transmission = '',
       certificate_voided = 'no', updated = ?, updated_by = 'admin',
       updated_by_name = ?, updated_by_id = ?
     WHERE id = ?`,
    [nowMysql(), adminName(session), adminId(session), cid]
  );
  return { ok: true, message: 'Certificate reset successfully' };
}

async function updateBookStatus(pool, id, status) {
  const bookId = Number(id);
  const next = trim(status) === 'On-Site' ? 'On-Site' : 'At-Office';
  const [rows] = await pool.query('SELECT id FROM dl_returns WHERE id = ? LIMIT 1', [
    bookId,
  ]);
  if (!rows?.length) return { ok: false, message: 'DL196 Book not found' };
  await pool.query('UPDATE dl_returns SET certificate_status = ? WHERE id = ?', [
    next,
    bookId,
  ]);
  return { ok: true, message: 'Status updated successfully.' };
}

async function deleteDlBook(pool, id) {
  const bookId = Number(id);
  const [rows] = await pool.query('SELECT id FROM dl_returns WHERE id = ? LIMIT 1', [
    bookId,
  ]);
  if (!rows?.length) return { ok: false, message: 'DL196 Book not found to delete' };
  await pool.query('DELETE FROM dl_return_certificates WHERE dl_return_id = ?', [
    bookId,
  ]);
  await pool.query('DELETE FROM dl_returns WHERE id = ?', [bookId]);
  return { ok: true, message: 'DL196 Book deleted successfully' };
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function exportDlBook(pool, id, { send = 'admin', email = '', resend = 0 } = {}) {
  const data = await getDlBook(pool, id);
  if (!data) return { ok: false, message: 'DL196 Book not found' };
  const rows = data.certificates;
  if (!rows.length) return { ok: false, message: 'No certificates to export' };

  const headers = [
    'ATB Number',
    'Certificate Number',
    'Completion Date',
    'Completion Time',
    'Course Duration',
    'Driver Number',
    'Instructor Certificate',
    'Restriction',
    'Transmission',
  ];
  const lines = [headers.join(',')];
  for (const v of rows) {
    const transmission =
      v.transmission !== '' && VEHICLE_TYPE[v.transmission] != null
        ? VEHICLE_TYPE[v.transmission]
        : v.transmission;
    lines.push(
      [
        `${v.atb_no}\t`,
        `${v.certificate_no}\t`,
        v.completion_date,
        v.completion_time,
        v.duration,
        v.attendee_licence,
        v.instructor_certificate,
        v.restriction,
        transmission,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  const csv = `${lines.join('\n')}\n`;
  const first = rows[0].certificate_no;
  const last = rows[rows.length - 1].certificate_no;
  const filename = `DL196 Returns for certifictes numbers ${first}-${last}.csv`;

  let toEmail = trim(email);
  if (send === 'dvsa') {
    const [course] = await pool.query(
      'SELECT dvsa_email FROM courses WHERE id = ? LIMIT 1',
      [data.book.course_id]
    );
    toEmail = trim(course?.[0]?.dvsa_email);
  } else if (send === 'custom' && toEmail) {
    // keep
  } else {
    toEmail = process.env.SITE_EMAIL || process.env.MAIL_FROM_EMAIL || toEmail;
  }

  if (toEmail) {
    const smtpSecure =
      String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
    const transporter = nodemailer.createTransport({
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
    const atb = rows[0].atb_no;
    const bookNo = data.book.book_no;
    await transporter.sendMail({
      from: getMailFrom(),
      to: toEmail,
      bcc: process.env.SITE_EMAIL || undefined,
      subject: `ATB Number ${atb} : DL196 Returns for Certificates Numbers ${first} - ${last} (Book ${bookNo})`,
      html: `Dear Sir / Madam,<br/><br/>Please find enclosed the digital DL196 Return for Certificate numbers ${first} - ${last} in a .csv format.<br/><br/>Kind Regards<br/>1 Stop Instruction`,
      attachments: [{ filename, content: csv, contentType: 'text/csv' }],
    });
  }

  await pool.query(
    'UPDATE dl_returns SET exported_on = ?, is_sent = 1 WHERE id = ?',
    [nowMysql(), data.book.id]
  );

  return {
    ok: true,
    message: 'DL Book CSV created',
    data: { filename, csv, sent_to: toEmail || null, resend: Number(resend) || 0 },
  };
}

module.exports = {
  listDlReturns,
  createDlBook,
  getDlBook,
  getCertificate,
  updateCertificate,
  resetCertificate,
  updateBookStatus,
  deleteDlBook,
  exportDlBook,
  getDlFormOptions,
};
