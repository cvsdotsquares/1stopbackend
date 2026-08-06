/**
 * Admin FAQs + FAQ categories (F-054).
 * Soft delete = status 0. Public site shows status = 1 only.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function parseId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseWeight(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseStatus(value, fallback = 1) {
  if (value == null || value === '') return fallback;
  return Number(value) === 0 ? 0 : 1;
}

function mapFaq(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    faq_title: row.faq_title || '',
    category_id: Number(row.category_id) || 0,
    category_name: row.category_name || '',
    content: row.content || '',
    status: Number(row.status) === 0 ? 0 : 1,
    weight: Number(row.weight) || 0,
    created: row.created || null,
    modified: row.modified || null,
  };
}

function mapCategory(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    category_name: row.category_name || '',
    weight: Number(row.weight) || 0,
    status: Number(row.status) === 0 ? 0 : 1,
    faqs_count: row.faqs_count != null ? Number(row.faqs_count) : undefined,
  };
}

async function listFaqs(pool, filters = {}) {
  const categoryId = parseId(filters.category_id);
  const statusFilter =
    filters.status === '0' || filters.status === '1'
      ? Number(filters.status)
      : null;
  const search = trim(filters.q);

  let sql = `
    SELECT f.*, fc.category_name
    FROM faqs f
    LEFT JOIN faq_categories fc ON f.category_id = fc.id
    WHERE 1=1
  `;
  const params = [];

  if (categoryId) {
    sql += ' AND f.category_id = ?';
    params.push(categoryId);
  }
  if (statusFilter != null) {
    sql += ' AND f.status = ?';
    params.push(statusFilter);
  }
  if (search) {
    sql += ' AND (f.faq_title LIKE ? OR f.content LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like);
  }

  sql += ' ORDER BY fc.weight ASC, f.category_id ASC, f.weight ASC, f.id ASC';

  const [rows] = await pool.query(sql, params);
  const items = (rows || []).map(mapFaq);

  const categories = await listCategories(pool, { includeInactive: true });

  // Group FAQs under categories for the admin list UI
  const byCategory = new Map();
  for (const cat of categories.items) {
    byCategory.set(cat.id, {
      category: cat,
      items: [],
    });
  }
  const uncategorized = [];
  for (const faq of items) {
    const bucket = byCategory.get(faq.category_id);
    if (bucket) bucket.items.push(faq);
    else uncategorized.push(faq);
  }

  const groups = [...byCategory.values()].filter((g) => {
    if (g.items.length > 0) return true;
    // Keep empty active categories on the unfiltered list so admins can edit them
    if (categoryId || statusFilter != null || search) return false;
    return g.category.status === 1;
  });
  if (uncategorized.length) {
    groups.push({
      category: {
        id: 0,
        category_name: 'Uncategorized',
        weight: 9999,
        status: 1,
      },
      items: uncategorized,
    });
  }

  return {
    groups,
    items,
    total: items.length,
    categories: categories.items,
  };
}

async function getFaqById(pool, id) {
  const faqId = parseId(id);
  if (!faqId) return null;
  const [rows] = await pool.query(
    `SELECT f.*, fc.category_name
       FROM faqs f
       LEFT JOIN faq_categories fc ON f.category_id = fc.id
      WHERE f.id = ?
      LIMIT 1`,
    [faqId]
  );
  return mapFaq(rows?.[0]);
}

async function getFormOptions(pool) {
  const categories = await listCategories(pool, { includeInactive: false });
  return {
    categories: categories.items.map((c) => ({
      id: c.id,
      label: c.category_name,
      weight: c.weight,
    })),
  };
}

async function createFaq(pool, body = {}) {
  const faqTitle = trim(body.faq_title);
  const content = body.content == null ? '' : String(body.content);
  const categoryId = parseId(body.category_id);
  const weight = parseWeight(body.weight, 0);
  const status = parseStatus(body.status, 1);

  if (!faqTitle) {
    return { ok: false, message: 'FAQ title is required' };
  }
  if (!categoryId) {
    return { ok: false, message: 'Category is required' };
  }

  const [catRows] = await pool.query(
    'SELECT id FROM faq_categories WHERE id = ? LIMIT 1',
    [categoryId]
  );
  if (!catRows?.length) {
    return { ok: false, message: 'Selected category was not found' };
  }

  const [result] = await pool.query(
    `INSERT INTO faqs (faq_title, category_id, content, status, weight, created, modified)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [faqTitle, categoryId, content, status, weight]
  );

  return {
    ok: true,
    message: 'FAQ added successfully',
    data: { id: result.insertId },
  };
}

async function updateFaq(pool, id, body = {}) {
  const faqId = parseId(id);
  if (!faqId) return { ok: false, message: 'FAQ not found' };

  const existing = await getFaqById(pool, faqId);
  if (!existing) return { ok: false, message: 'FAQ not found' };

  const faqTitle =
    body.faq_title != null ? trim(body.faq_title) : existing.faq_title;
  const content =
    body.content != null ? String(body.content) : existing.content;
  const categoryId =
    body.category_id != null
      ? parseId(body.category_id)
      : existing.category_id;
  const weight =
    body.weight != null ? parseWeight(body.weight, existing.weight) : existing.weight;
  const status =
    body.status != null ? parseStatus(body.status, existing.status) : existing.status;

  if (!faqTitle) {
    return { ok: false, message: 'FAQ title is required' };
  }
  if (!categoryId) {
    return { ok: false, message: 'Category is required' };
  }

  const [catRows] = await pool.query(
    'SELECT id FROM faq_categories WHERE id = ? LIMIT 1',
    [categoryId]
  );
  if (!catRows?.length) {
    return { ok: false, message: 'Selected category was not found' };
  }

  await pool.query(
    `UPDATE faqs
        SET faq_title = ?, category_id = ?, content = ?, status = ?, weight = ?, modified = NOW()
      WHERE id = ?`,
    [faqTitle, categoryId, content, status, weight, faqId]
  );

  return {
    ok: true,
    message: 'FAQ updated successfully',
    data: { id: faqId },
  };
}

async function softDeleteFaq(pool, id) {
  const faqId = parseId(id);
  if (!faqId) return { ok: false, message: 'FAQ not found' };

  const [result] = await pool.query(
    'UPDATE faqs SET status = 0, modified = NOW() WHERE id = ?',
    [faqId]
  );
  if (!result.affectedRows) {
    return { ok: false, message: 'FAQ not found' };
  }
  return { ok: true, message: 'FAQ deleted successfully' };
}

async function listCategories(pool, options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  let sql = `
    SELECT fc.*,
      (SELECT COUNT(*) FROM faqs f WHERE f.category_id = fc.id) AS faqs_count
    FROM faq_categories fc
  `;
  if (!includeInactive) {
    sql += ' WHERE fc.status = 1';
  }
  sql += ' ORDER BY fc.weight ASC, fc.id ASC';

  const [rows] = await pool.query(sql);
  return { items: (rows || []).map(mapCategory) };
}

async function getCategoryById(pool, id) {
  const categoryId = parseId(id);
  if (!categoryId) return null;
  const [rows] = await pool.query(
    `SELECT fc.*,
      (SELECT COUNT(*) FROM faqs f WHERE f.category_id = fc.id) AS faqs_count
     FROM faq_categories fc
     WHERE fc.id = ?
     LIMIT 1`,
    [categoryId]
  );
  return mapCategory(rows?.[0]);
}

async function createCategory(pool, body = {}) {
  const categoryName = trim(body.category_name);
  const weight = parseWeight(body.weight, 0);
  const status = parseStatus(body.status, 1);

  if (!categoryName) {
    return { ok: false, message: 'Category name is required' };
  }

  const [dup] = await pool.query(
    'SELECT id FROM faq_categories WHERE category_name = ? LIMIT 1',
    [categoryName]
  );
  if (dup?.length) {
    return { ok: false, message: 'A category with this name already exists' };
  }

  const [result] = await pool.query(
    `INSERT INTO faq_categories (category_name, weight, status)
     VALUES (?, ?, ?)`,
    [categoryName, weight, status]
  );

  return {
    ok: true,
    message: 'FAQ category added successfully',
    data: { id: result.insertId },
  };
}

async function updateCategory(pool, id, body = {}) {
  const categoryId = parseId(id);
  if (!categoryId) return { ok: false, message: 'Category not found' };

  const existing = await getCategoryById(pool, categoryId);
  if (!existing) return { ok: false, message: 'Category not found' };

  const categoryName =
    body.category_name != null
      ? trim(body.category_name)
      : existing.category_name;
  const weight =
    body.weight != null
      ? parseWeight(body.weight, existing.weight)
      : existing.weight;
  const status =
    body.status != null
      ? parseStatus(body.status, existing.status)
      : existing.status;

  if (!categoryName) {
    return { ok: false, message: 'Category name is required' };
  }

  const [dup] = await pool.query(
    'SELECT id FROM faq_categories WHERE category_name = ? AND id != ? LIMIT 1',
    [categoryName, categoryId]
  );
  if (dup?.length) {
    return { ok: false, message: 'A category with this name already exists' };
  }

  await pool.query(
    `UPDATE faq_categories
        SET category_name = ?, weight = ?, status = ?
      WHERE id = ?`,
    [categoryName, weight, status, categoryId]
  );

  return {
    ok: true,
    message: 'FAQ category updated successfully',
    data: { id: categoryId },
  };
}

async function softDeleteCategory(pool, id) {
  const categoryId = parseId(id);
  if (!categoryId) return { ok: false, message: 'Category not found' };

  const [activeFaqs] = await pool.query(
    'SELECT COUNT(*) AS count FROM faqs WHERE category_id = ? AND status = 1',
    [categoryId]
  );
  const activeCount = Number(activeFaqs?.[0]?.count) || 0;
  if (activeCount > 0) {
    return {
      ok: false,
      message: `Cannot delete category: ${activeCount} active FAQ(s) still use it. Deactivate or move them first.`,
    };
  }

  const [result] = await pool.query(
    'UPDATE faq_categories SET status = 0 WHERE id = ?',
    [categoryId]
  );
  if (!result.affectedRows) {
    return { ok: false, message: 'Category not found' };
  }
  return { ok: true, message: 'FAQ category deleted successfully' };
}

module.exports = {
  listFaqs,
  getFaqById,
  getFormOptions,
  createFaq,
  updateFaq,
  softDeleteFaq,
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  softDeleteCategory,
};
