const { parseActiveStatus } = require('./adminStatus');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

const PER_PAGE = 1000;

async function listFaqsAdmin(pool, { page = 1, name_scr = '', cat_scr = '' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PER_PAGE;
  let where = ' WHERE 1=1 ';
  const params = [];
  const title = trim(name_scr);
  const catId = trim(cat_scr);
  if (title) {
    where += ' AND faqs.faq_title LIKE ?';
    params.push(`%${title}%`);
  }
  if (catId) {
    where += ' AND faqs.category_id = ?';
    params.push(Number(catId));
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM faqs
     LEFT JOIN faq_categories ON faqs.category_id = faq_categories.id ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;

  const [rows] = await pool.query(
    `SELECT faqs.id AS faq_main_id, faqs.category_id, faqs.faq_title, faqs.status,
            faq_categories.id AS cat_id, faq_categories.category_name
     FROM faqs
     LEFT JOIN faq_categories ON faqs.category_id = faq_categories.id
     ${where}
     ORDER BY faqs.id DESC
     LIMIT ?, ?`,
    [...params, offset, PER_PAGE]
  );

  const categories = await getFaqCategories(pool, false);

  return {
    items: rows || [],
    categories,
    pagination: {
      page: pageNum,
      perPage: PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
    },
    filters: { name_scr: title, cat_scr: catId },
  };
}

async function getFaqCategories(pool, activeOnly = true) {
  const where = activeOnly ? ' WHERE status = 1 ' : '';
  const [rows] = await pool.query(`SELECT * FROM faq_categories ${where} ORDER BY weight, id ASC`);
  return rows || [];
}

async function getFaqCategoryById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM faq_categories WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  return rows?.[0] || null;
}

async function checkFaqExists(pool, faq_title, cat_id, excludeId = 0) {
  let sql = 'SELECT COUNT(id) AS cnt FROM faqs WHERE faq_title = ? AND category_id = ?';
  const params = [faq_title, Number(cat_id)];
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(Number(excludeId));
  }
  const [[row]] = await pool.query(sql, params);
  return Number(row?.cnt) > 0;
}

async function checkCategoryNameExists(pool, category_name, excludeId = 0) {
  let sql = 'SELECT id FROM faq_categories WHERE category_name = ? LIMIT 1';
  const params = [category_name];
  if (excludeId) {
    sql = 'SELECT id FROM faq_categories WHERE category_name = ? AND id != ? LIMIT 1';
    params.push(Number(excludeId));
  }
  const [rows] = await pool.query(sql, params);
  return rows?.length > 0;
}

async function createFaqCategory(pool, body) {
  const category_name = trim(body.category_name);
  const weight = trim(body.weight) || '0';
  const status = parseActiveStatus(body.status, 1);
  if (!category_name) {
    return { ok: false, message: 'Required fields can not be left blank' };
  }
  if (await checkCategoryNameExists(pool, category_name)) {
    return { ok: false, message: 'Category Name already exits.' };
  }
  const [result] = await pool.query(
    'INSERT INTO faq_categories (category_name, weight, status) VALUES (?, ?, ?)',
    [category_name, weight, status]
  );
  return { ok: true, message: 'Category Name added successfully', id: result.insertId };
}

async function updateFaqCategory(pool, id, body) {
  const existing = await getFaqCategoryById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Category not found' };
  }
  const category_name = trim(body.category_name);
  const weight = trim(body.weight) || '0';
  const status = parseActiveStatus(
    body.status,
    Number(existing.status) === 1 ? 1 : 0
  );
  if (!category_name) {
    return { ok: false, message: 'Required fields can not be left blank' };
  }
  if (await checkCategoryNameExists(pool, category_name, id)) {
    return { ok: false, message: 'Category Name already exits.' };
  }
  await pool.query(
    'UPDATE faq_categories SET category_name = ?, weight = ?, status = ? WHERE id = ?',
    [category_name, weight, status, Number(id)]
  );
  return { ok: true, message: 'Category Name edited successfully' };
}

async function softDeleteFaqCategory(pool, id) {
  const existing = await getFaqCategoryById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Record not found to delete' };
  }
  await pool.query('UPDATE faq_categories SET status = 0 WHERE id = ?', [Number(id)]);
  await pool.query('UPDATE faqs SET status = 0 WHERE category_id = ?', [Number(id)]);
  return { ok: true, message: 'Record deleted successfully' };
}

async function getFaqById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM faqs WHERE id = ? LIMIT 1', [Number(id)]);
  return rows?.[0] || null;
}

async function createFaq(pool, body) {
  const faq_title = trim(body.faq_title);
  const category_id = trim(body.category_id);
  const content = trim(body.content);
  const weight = trim(body.weight) || '0';
  const status = parseActiveStatus(body.status, 1);

  if (!faq_title || !category_id || !content) {
    return { ok: false, message: 'Required fields can not be left blank' };
  }
  if (await checkFaqExists(pool, faq_title, category_id)) {
    return { ok: false, message: 'Faq already exits.' };
  }

  const now = new Date();
  const [result] = await pool.query(
    `INSERT INTO faqs (faq_title, category_id, content, weight, status, created, modified)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [faq_title, Number(category_id), content, weight, status, now, now]
  );
  return { ok: true, message: 'Faq added successfully', id: result.insertId };
}

async function updateFaq(pool, id, body) {
  const existing = await getFaqById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Faq not found' };
  }
  const faq_title = trim(body.faq_title);
  const category_id = trim(body.category_id);
  const content = trim(body.content);
  const weight = trim(body.weight) || '0';
  const status = parseActiveStatus(
    body.status,
    Number(existing.status) === 1 ? 1 : 0
  );

  if (!faq_title || !category_id || !content) {
    return { ok: false, message: 'Required fields can not be left blank' };
  }
  if (await checkFaqExists(pool, faq_title, category_id, id)) {
    return { ok: false, message: 'Faq already exits.' };
  }

  await pool.query(
    `UPDATE faqs SET faq_title = ?, category_id = ?, content = ?, weight = ?, status = ?, modified = ?
     WHERE id = ?`,
    [faq_title, Number(category_id), content, weight, status, new Date(), Number(id)]
  );
  return { ok: true, message: 'Faq edited successfully' };
}

async function softDeleteFaq(pool, id) {
  const existing = await getFaqById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Record not found to delete' };
  }
  await pool.query('UPDATE faqs SET status = 0 WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Record deleted successfully' };
}

module.exports = {
  listFaqsAdmin,
  getFaqCategories,
  getFaqCategoryById,
  createFaqCategory,
  updateFaqCategory,
  softDeleteFaqCategory,
  getFaqById,
  createFaq,
  updateFaq,
  softDeleteFaq,
};
