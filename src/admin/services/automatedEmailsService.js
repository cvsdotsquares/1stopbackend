const DEFAULT_PAGE_SIZE = 10;

/**
 * List automated emails with course join, search, and pagination
 */
async function listAutomatedEmails(pool, { page = 1, limit = DEFAULT_PAGE_SIZE, search = '', search_email = '', email_search = '', course_id = '' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE);
  const offset = (pageNum - 1) * pageSize;

  let where = ' WHERE 1=1 ';
  const params = [];

  const trimmedSearch = String(search || '').trim();
  if (trimmedSearch) {
    where += ' AND ae.subject LIKE ? ';
    params.push(`%${trimmedSearch}%`);
  }

  const trimmedEmailSearch = String(email_search || search_email || '').trim();
  if (trimmedEmailSearch) {
    where += ' AND ae.automated_email_content LIKE ? ';
    params.push(`%${trimmedEmailSearch}%`);
  }

  const courseIdNum = Number(course_id);
  if (courseIdNum > 0) {
    where += ' AND ae.course_id = ? ';
    params.push(courseIdNum);
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM automated_emails ae
     ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;

  const [rows] = await pool.query(
    `SELECT
       ae.id,
       ae.day,
       ae.month,
       ae.year,
       ae.course_id,
       ae.subject,
       ae.automated_email_content,
       ae.status,
       ae.last_sent,
       ae.created,
       c.course_name
     FROM automated_emails ae
     LEFT JOIN courses c ON ae.course_id = c.id
     ${where}
     ORDER BY ae.id DESC
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
 * Get single automated email by ID
 */
async function getAutomatedEmailById(pool, emailId) {
  const id = Number(emailId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const [rows] = await pool.query(
    `SELECT
       ae.id,
       ae.day,
       ae.month,
       ae.year,
       ae.course_id,
       ae.subject,
       ae.automated_email_content,
       ae.status,
       ae.last_sent,
       ae.created,
       c.course_name
     FROM automated_emails ae
     LEFT JOIN courses c ON ae.course_id = c.id
     WHERE ae.id = ?
     LIMIT 1`,
    [id]
  );

  return (rows && rows[0]) || null;
}

/**
 * Get courses list for dropdown (non-deleted courses matching legacy)
 */
async function getCoursesList(pool, includeCourseId = null) {
  let query = "SELECT id, course_name FROM courses WHERE isDeleted = '0'";
  const params = [];
  const incId = Number(includeCourseId);
  if (incId > 0) {
    query += ' OR id = ?';
    params.push(incId);
  }
  query += ' ORDER BY course_name ASC';
  const [rows] = await pool.query(query, params);
  return rows || [];
}

/**
 * Create automated email
 */
async function createAutomatedEmail(pool, data) {
  const courseId = Number(data.course_id);
  const subject = String(data.subject || '').trim();
  const content = String(data.automated_email_content || '').trim();
  const day = Math.max(0, parseInt(data.day, 10) || 0);
  const month = Math.max(0, parseInt(data.month, 10) || 0);
  const year = Math.max(0, parseInt(data.year, 10) || 0);
  const status = Number(data.status) === 0 ? 0 : 1;

  if (!courseId || courseId <= 0) {
    return { ok: false, message: 'Please select a course' };
  }
  if (!subject) {
    return { ok: false, message: 'Subject is required' };
  }
  if (!content) {
    return { ok: false, message: 'Email content cannot be empty' };
  }

  // Verify course exists
  const [courses] = await pool.query('SELECT id FROM courses WHERE id = ? LIMIT 1', [courseId]);
  if (!courses || courses.length === 0) {
    return { ok: false, message: 'Selected course does not exist' };
  }

  const [result] = await pool.query(
    `INSERT INTO automated_emails (
       course_id,
       subject,
       automated_email_content,
       day,
       month,
       year,
       status,
       last_sent
     ) VALUES (?, ?, ?, ?, ?, ?, ?, '1970-01-01 00:00:00')`,
    [courseId, subject, content, day, month, year, status]
  );

  return {
    ok: true,
    message: 'Automated email added successfully',
    id: result.insertId,
  };
}

/**
 * Update automated email
 */
async function updateAutomatedEmail(pool, emailId, data) {
  const id = Number(emailId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid automated email ID' };
  }

  const existing = await getAutomatedEmailById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Automated email not found' };
  }

  const courseId = data.course_id !== undefined ? Number(data.course_id) : existing.course_id;
  const subject = data.subject !== undefined ? String(data.subject || '').trim() : existing.subject;
  const content = data.automated_email_content !== undefined ? String(data.automated_email_content || '').trim() : existing.automated_email_content;
  const day = data.day !== undefined ? Math.max(0, parseInt(data.day, 10) || 0) : existing.day;
  const month = data.month !== undefined ? Math.max(0, parseInt(data.month, 10) || 0) : existing.month;
  const year = data.year !== undefined ? Math.max(0, parseInt(data.year, 10) || 0) : existing.year;
  const status = data.status !== undefined ? (Number(data.status) === 1 ? 1 : 0) : existing.status;

  if (!courseId || courseId <= 0) {
    return { ok: false, message: 'Please select a course' };
  }
  if (!subject) {
    return { ok: false, message: 'Subject is required' };
  }
  if (!content) {
    return { ok: false, message: 'Email content cannot be empty' };
  }

  await pool.query(
    `UPDATE automated_emails SET
       course_id = ?,
       subject = ?,
       automated_email_content = ?,
       day = ?,
       month = ?,
       year = ?,
       status = ?
     WHERE id = ?`,
    [courseId, subject, content, day, month, year, status, id]
  );

  return {
    ok: true,
    message: 'Automated email updated successfully',
  };
}

/**
 * Toggle status of automated email
 */
async function toggleAutomatedEmailStatus(pool, emailId, newStatus = null) {
  const id = Number(emailId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid automated email ID' };
  }

  const existing = await getAutomatedEmailById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Automated email not found' };
  }

  const targetStatus = newStatus !== null ? (Number(newStatus) === 1 ? 1 : 0) : (existing.status === 1 ? 0 : 1);

  await pool.query('UPDATE automated_emails SET status = ? WHERE id = ?', [targetStatus, id]);

  return {
    ok: true,
    message: 'Status updated successfully',
    status: targetStatus,
  };
}

/**
 * Delete automated email
 */
async function deleteAutomatedEmail(pool, emailId) {
  const id = Number(emailId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Invalid automated email ID' };
  }

  const [res] = await pool.query('DELETE FROM automated_emails WHERE id = ?', [id]);
  if (res.affectedRows === 0) {
    return { ok: false, message: 'Automated email not found' };
  }

  return {
    ok: true,
    message: 'Automated email deleted successfully',
  };
}

module.exports = {
  listAutomatedEmails,
  getAutomatedEmailById,
  getCoursesList,
  createAutomatedEmail,
  updateAutomatedEmail,
  toggleAutomatedEmailStatus,
  deleteAutomatedEmail,
};
