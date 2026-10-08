const { parseActiveStatus } = require('./adminStatus');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

const PER_PAGE = 10;

async function listTestimonials(pool, { page = 1, name_scr = '' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PER_PAGE;
  let where = ' WHERE 1=1 ';
  const params = [];
  const search = trim(name_scr);
  if (search) {
    where += ' AND (review_name LIKE ? OR review LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM testimonials ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;

  const [rows] = await pool.query(
    `SELECT * FROM testimonials ${where} ORDER BY id DESC LIMIT ?, ?`,
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

async function getTestimonialById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM testimonials WHERE id = ? LIMIT 1', [
    Number(id),
  ]);
  return rows?.[0] || null;
}

async function createTestimonial(pool, body) {
  const review = trim(body.review);
  const review_name = trim(body.review_name);
  const status = parseActiveStatus(body.status, 1);

  if (!review || !review_name) {
    return {
      ok: false,
      message: 'Required fields mark with * can not be left blank',
    };
  }

  const [result] = await pool.query(
    'INSERT INTO testimonials (review, review_name, status, created) VALUES (?, ?, ?, NOW())',
    [review, review_name, status]
  );

  return {
    ok: true,
    message: 'Testimonial added successfully',
    id: result.insertId,
  };
}

async function updateTestimonial(pool, id, body) {
  const existing = await getTestimonialById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Testimonial not found to edit' };
  }

  const review = trim(body.review);
  const review_name = trim(body.review_name);
  const status = parseActiveStatus(
    body.status,
    Number(existing.status) === 1 ? 1 : 0
  );

  if (!review || !review_name) {
    return {
      ok: false,
      message: 'Required fields mark with * can not be left blank',
    };
  }

  await pool.query(
    'UPDATE testimonials SET review = ?, review_name = ?, status = ? WHERE id = ?',
    [review, review_name, status, Number(id)]
  );

  return { ok: true, message: 'Testimonial edited successfully' };
}

async function deleteTestimonial(pool, id) {
  const existing = await getTestimonialById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Testimonial not found to delete' };
  }
  await pool.query('DELETE FROM testimonials WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Testimonial deleted successfully' };
}

module.exports = {
  listTestimonials,
  getTestimonialById,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
};
