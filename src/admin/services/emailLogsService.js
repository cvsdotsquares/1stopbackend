/**
 * Admin email logs — port of legacy email_logs.php / getMailLogs / get_email_log.
 * Uses parameterized LIKE (legacy PHP concatenated strings — do not copy that).
 */
const RECORDS_PER_PAGE = 10;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function buildListWhere(searchterm = {}) {
  const whereParts = ["email_logs.id != ''"];
  const params = [];

  const nameScr = trim(searchterm.name_scr);
  if (nameScr) {
    const like = `%${nameScr}%`;
    whereParts.push(`(
      email_logs.\`to\` LIKE ?
      OR email_logs.cc LIKE ?
      OR email_logs.bcc LIKE ?
      OR email_logs.subject LIKE ?
      OR email_logs.email_content LIKE ?
      OR email_logs.created LIKE ?
      OR email_logs.book_ref LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like);
  }

  const statusScr = trim(searchterm.status_scr);
  if (statusScr !== '') {
    whereParts.push('email_logs.status = ?');
    params.push(statusScr);
  }

  return {
    where: `WHERE ${whereParts.join(' AND ')}`,
    params,
  };
}

function mapEmailLogRow(row) {
  const bccRaw = row.bcc || '';
  const dashPos = bccRaw.indexOf('-');
  const bcc = dashPos > 0 ? bccRaw.slice(0, dashPos).trim() : bccRaw;

  return {
    id: row.id,
    book_ref: row.book_ref || '',
    to: row.to || '',
    cc: row.cc || '',
    bcc,
    bcc_raw: bccRaw,
    from: row.from || '',
    subject: row.subject || '',
    email_by: row.email_by || '',
    email_by_label: row.email_by === 't' ? 'By Admin' : 'Online',
    type: row.type || '',
    status: Number(row.status) || 0,
    status_label: Number(row.status) === 1 ? 'Sent' : 'Failed',
    created: row.created,
    ip: row.ip || '',
  };
}

async function listEmailLogs(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const { where, params } = buildListWhere(searchterm);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM email_logs ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT id, \`to\`, cc, bcc, \`from\`, subject, email_by, status, type,
            book_ref, ip, created
     FROM email_logs
     ${where}
     ORDER BY email_logs.id DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  return {
    items: (rows || []).map(mapEmailLogRow),
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: {
      name_scr: trim(searchterm.name_scr),
      status_scr: trim(searchterm.status_scr),
    },
    statusOptions: [
      { value: '', label: 'All' },
      { value: '1', label: 'Sent' },
      { value: '0', label: 'Failed' },
    ],
  };
}

async function deleteEmailLog(pool, id) {
  const logId = Number(id);
  if (!Number.isFinite(logId) || logId <= 0) {
    return { ok: false, message: 'Mail not found to delete' };
  }

  const [existing] = await pool.query(
    'SELECT id FROM email_logs WHERE id = ? LIMIT 1',
    [logId]
  );
  if (!existing?.length) {
    return { ok: false, message: 'Mail not found to delete' };
  }

  const [result] = await pool.query('DELETE FROM email_logs WHERE id = ?', [
    logId,
  ]);
  if (!result?.affectedRows) {
    return { ok: false, message: 'Error in deleting mail' };
  }

  return { ok: true, message: 'Mail deleted successfully' };
}

async function getEmailLogContent(pool, id) {
  const logId = Number(id);
  if (!Number.isFinite(logId) || logId <= 0) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT id, ip, subject, email_content, \`to\`, cc, bcc, \`from\`,
            email_by, status, type, book_ref, created
     FROM email_logs
     WHERE id = ?
     LIMIT 1`,
    [logId]
  );

  const row = rows?.[0];
  if (!row) return null;

  return {
    id: row.id,
    ip: row.ip || '',
    subject: row.subject || '',
    email_content: row.email_content || '',
    to: row.to || '',
    cc: row.cc || '',
    bcc: row.bcc || '',
    from: row.from || '',
    email_by: row.email_by || '',
    status: Number(row.status) || 0,
    type: row.type || '',
    book_ref: row.book_ref || '',
    created: row.created,
  };
}

module.exports = {
  listEmailLogs,
  deleteEmailLog,
  getEmailLogContent,
  RECORDS_PER_PAGE,
};
