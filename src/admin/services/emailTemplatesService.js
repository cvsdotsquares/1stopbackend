const MAX_TITLE = 200;
const MAX_BODY = 100000;

let tableReady = null;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function ensureEmailTemplatesTable(pool) {
  if (!tableReady) {
    tableReady = pool
      .query(
        `CREATE TABLE IF NOT EXISTS email_templates (
           id INT UNSIGNED NOT NULL AUTO_INCREMENT,
           title VARCHAR(200) NOT NULL,
           body MEDIUMTEXT NOT NULL,
           created DATETIME NOT NULL,
           modified DATETIME NOT NULL,
           PRIMARY KEY (id),
           KEY idx_email_templates_title (title)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      )
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    title: row.title || '',
    body: row.body || '',
    created: row.created || null,
    modified: row.modified || null,
  };
}

async function listEmailTemplates(pool, { page = 1, limit = 25, search = '' } = {}) {
  await ensureEmailTemplatesTable(pool);
  const pageNum = Math.max(1, Number(page) || 1);
  const take = Math.min(100, Math.max(1, Number(limit) || 25));
  const offset = (pageNum - 1) * take;
  const term = trim(search);

  let where = '';
  const params = [];
  if (term) {
    where = ' WHERE title LIKE ? ';
    params.push(`%${term}%`);
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM email_templates ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;
  const [rows] = await pool.query(
    `SELECT id, title, body, created, modified
     FROM email_templates
     ${where}
     ORDER BY title ASC, id DESC
     LIMIT ?, ?`,
    [...params, offset, take]
  );

  return {
    items: (rows || []).map(mapRow),
    pagination: {
      page: pageNum,
      perPage: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
    filters: { search: term },
  };
}

async function listEmailTemplateOptions(pool) {
  await ensureEmailTemplatesTable(pool);
  const [rows] = await pool.query(
    `SELECT id, title
     FROM email_templates
     ORDER BY title ASC, id DESC
     LIMIT 500`
  );
  return (rows || []).map((row) => ({
    id: Number(row.id),
    title: row.title || '',
  }));
}

async function getEmailTemplateById(pool, id) {
  await ensureEmailTemplatesTable(pool);
  const templateId = Number(id);
  if (!Number.isFinite(templateId) || templateId <= 0) return null;
  const [rows] = await pool.query(
    `SELECT id, title, body, created, modified
     FROM email_templates
     WHERE id = ?
     LIMIT 1`,
    [templateId]
  );
  return mapRow(rows?.[0]);
}

function readTemplateInput(body) {
  const title = trim(body?.title).slice(0, MAX_TITLE);
  const content = trim(body?.body);
  if (!title) {
    return { ok: false, message: 'Enter a title.' };
  }
  if (!content) {
    return { ok: false, message: 'Enter an email body.' };
  }
  if (content.length > MAX_BODY) {
    return { ok: false, message: 'The email body is too long.' };
  }
  return { ok: true, title, body: content };
}

async function createEmailTemplate(pool, body) {
  await ensureEmailTemplatesTable(pool);
  const input = readTemplateInput(body);
  if (!input.ok) return input;
  const [result] = await pool.query(
    `INSERT INTO email_templates (title, body, created, modified)
     VALUES (?, ?, NOW(), NOW())`,
    [input.title, input.body]
  );
  return {
    ok: true,
    id: result.insertId,
    message: 'Email template created.',
  };
}

async function updateEmailTemplate(pool, id, body) {
  await ensureEmailTemplatesTable(pool);
  const existing = await getEmailTemplateById(pool, id);
  if (!existing) return { ok: false, message: 'Email template not found.' };
  const input = readTemplateInput(body);
  if (!input.ok) return input;
  await pool.query(
    `UPDATE email_templates
     SET title = ?, body = ?, modified = NOW()
     WHERE id = ?`,
    [input.title, input.body, existing.id]
  );
  return { ok: true, message: 'Email template updated.' };
}

async function deleteEmailTemplate(pool, id) {
  await ensureEmailTemplatesTable(pool);
  const existing = await getEmailTemplateById(pool, id);
  if (!existing) return { ok: false, message: 'Email template not found.' };
  await pool.query('DELETE FROM email_templates WHERE id = ?', [existing.id]);
  return { ok: true, message: 'Email template deleted.' };
}

module.exports = {
  listEmailTemplates,
  listEmailTemplateOptions,
  getEmailTemplateById,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
};
