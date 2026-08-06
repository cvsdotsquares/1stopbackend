/**
 * Admin testimonials (F-056).
 * Soft delete = status 0. Public site shows status = 1 only.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function parseId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseStatus(value, fallback = 1) {
  if (value == null || value === '') return fallback;
  return Number(value) === 0 ? 0 : 1;
}

function mapTestimonial(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    review: row.review || '',
    review_name: row.review_name || '',
    status: Number(row.status) === 0 ? 0 : 1,
    created: row.created || null,
  };
}

async function listTestimonials(pool, filters = {}) {
  const statusFilter =
    filters.status === '0' || filters.status === '1'
      ? Number(filters.status)
      : null;
  const search = trim(filters.q);

  let sql = `
    SELECT id, review, review_name, status, created
    FROM testimonials
    WHERE 1=1
  `;
  const params = [];

  if (statusFilter != null) {
    sql += ' AND status = ?';
    params.push(statusFilter);
  }
  if (search) {
    sql += ' AND (review LIKE ? OR review_name LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like);
  }

  sql += ' ORDER BY created DESC, id DESC';

  const [rows] = await pool.query(sql, params);
  const items = (rows || []).map(mapTestimonial);
  return { items, total: items.length };
}

async function getTestimonialById(pool, id) {
  const testimonialId = parseId(id);
  if (!testimonialId) return null;
  const [rows] = await pool.query(
    `SELECT id, review, review_name, status, created
       FROM testimonials
      WHERE id = ?
      LIMIT 1`,
    [testimonialId]
  );
  return mapTestimonial(rows?.[0]);
}

async function createTestimonial(pool, body = {}) {
  const review = trim(body.review);
  const reviewName = trim(body.review_name);
  const status = parseStatus(body.status, 1);

  if (!review) {
    return { ok: false, message: 'Review text is required' };
  }
  if (review.length > 255) {
    return { ok: false, message: 'Review text must be 255 characters or fewer' };
  }
  if (!reviewName) {
    return { ok: false, message: 'Reviewer name is required' };
  }
  if (reviewName.length > 100) {
    return { ok: false, message: 'Reviewer name must be 100 characters or fewer' };
  }

  const [result] = await pool.query(
    `INSERT INTO testimonials (review, review_name, status, created)
     VALUES (?, ?, ?, NOW())`,
    [review, reviewName, status]
  );

  return {
    ok: true,
    message: 'Testimonial added successfully',
    data: { id: result.insertId },
  };
}

async function updateTestimonial(pool, id, body = {}) {
  const testimonialId = parseId(id);
  if (!testimonialId) return { ok: false, message: 'Testimonial not found' };

  const existing = await getTestimonialById(pool, testimonialId);
  if (!existing) return { ok: false, message: 'Testimonial not found' };

  const review = body.review != null ? trim(body.review) : existing.review;
  const reviewName =
    body.review_name != null ? trim(body.review_name) : existing.review_name;
  const status =
    body.status != null
      ? parseStatus(body.status, existing.status)
      : existing.status;

  if (!review) {
    return { ok: false, message: 'Review text is required' };
  }
  if (review.length > 255) {
    return { ok: false, message: 'Review text must be 255 characters or fewer' };
  }
  if (!reviewName) {
    return { ok: false, message: 'Reviewer name is required' };
  }
  if (reviewName.length > 100) {
    return { ok: false, message: 'Reviewer name must be 100 characters or fewer' };
  }

  await pool.query(
    `UPDATE testimonials
        SET review = ?, review_name = ?, status = ?
      WHERE id = ?`,
    [review, reviewName, status, testimonialId]
  );

  return {
    ok: true,
    message: 'Testimonial updated successfully',
    data: { id: testimonialId },
  };
}

async function softDeleteTestimonial(pool, id) {
  const testimonialId = parseId(id);
  if (!testimonialId) return { ok: false, message: 'Testimonial not found' };

  const [result] = await pool.query(
    'UPDATE testimonials SET status = 0 WHERE id = ?',
    [testimonialId]
  );
  if (!result.affectedRows) {
    return { ok: false, message: 'Testimonial not found' };
  }
  return { ok: true, message: 'Testimonial deleted successfully' };
}

module.exports = {
  listTestimonials,
  getTestimonialById,
  createTestimonial,
  updateTestimonial,
  softDeleteTestimonial,
};
