const fs = require('fs');
const path = require('path');
const { parseActiveStatus } = require('./adminStatus');
const { loadPageEditor } = require('./pageEditor/loadPageEditor');
const { getSectionCatalog } = require('./pagesService');
const {
  trim,
  getFrontUploadDir,
  saveTimeBasenameUpload,
} = require('./pageEditor/helpers');

const PER_PAGE = 5;
const UPLOAD_SUBDIR = 'location_course_files';

function uploadDir() {
  return getFrontUploadDir(UPLOAD_SUBDIR);
}

function normalizeSlug(raw) {
  let slug = trim(raw).toLowerCase().replace(/\s+/g, '-');
  slug = slug.replace(/[^a-z0-9-]/g, '');
  slug = slug.replace(/-+/g, '-');
  return slug.replace(/^-+|-+$/g, '');
}

async function ensureUniqueSlug(pool, slug, excludeId = 0) {
  let candidate = slug;
  let counter = 1;
  const original = slug;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = [candidate];
    let sql = 'SELECT id FROM location_course_pages WHERE slug = ?';
    if (excludeId) {
      sql += ' AND id != ?';
      params.push(Number(excludeId));
    }
    const [rows] = await pool.query(`${sql} LIMIT 1`, params);
    if (!rows?.length) return candidate;
    candidate = `${original}-${counter}`;
    counter += 1;
  }
}

async function listLocationCoursePages(pool, { page = 1, name_scr = '', location_filter = '', course_filter = '' } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const offset = (pageNum - 1) * PER_PAGE;
  let where = ' WHERE 1=1 ';
  const params = [];

  const name = trim(name_scr);
  if (name) {
    where += ' AND lcp.page_title LIKE ?';
    params.push(`%${name}%`);
  }
  const loc = trim(location_filter);
  if (loc) {
    where += ' AND lcp.location_id = ?';
    params.push(Number(loc));
  }
  const crs = trim(course_filter);
  if (crs) {
    where += ' AND lcp.course_id = ?';
    params.push(Number(crs));
  }

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM location_course_pages lcp ${where}`,
    params
  );
  const total = Number(countRow?.total) || 0;

  const [rows] = await pool.query(
    `SELECT lcp.*, l.location_name, c.course_name
     FROM location_course_pages lcp
     LEFT JOIN locations l ON lcp.location_id = l.id
     LEFT JOIN courses c ON lcp.course_id = c.id
     ${where}
     ORDER BY lcp.id DESC
     LIMIT ?, ?`,
    [...params, offset, PER_PAGE]
  );

  const [locations] = await pool.query(
    "SELECT id, location_name FROM locations WHERE status = '1' ORDER BY location_name"
  );
  const [courses] = await pool.query(
    'SELECT id, course_name FROM courses ORDER BY course_name'
  );

  return {
    items: rows || [],
    filters: { name_scr: name, location_filter: loc, course_filter: crs },
    filterOptions: { locations: locations || [], courses: courses || [] },
    pagination: {
      page: pageNum,
      perPage: PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
    },
  };
}

async function getLocationCoursePageById(pool, id) {
  const [rows] = await pool.query(
    `SELECT lcp.*, l.location_name, c.course_name
     FROM location_course_pages lcp
     LEFT JOIN locations l ON lcp.location_id = l.id
     LEFT JOIN courses c ON lcp.course_id = c.id
     WHERE lcp.id = ? LIMIT 1`,
    [Number(id)]
  );
  return rows?.[0] || null;
}

async function loadNewLocationCourseEditor(pool) {
  const [locations] = await pool.query(
    "SELECT id, location_name FROM locations WHERE status = '1' ORDER BY location_name"
  );
  const [courses] = await pool.query('SELECT id, course_name FROM courses ORDER BY course_name');
  const sectionCatalog = await getSectionCatalog(pool);
  return {
    page: {
      location_id: '',
      course_id: '',
      page_title: '',
      content: '',
      meta_description: '',
      meta_keywords: '',
      slug: '',
      is_active: 1,
      locationPicture: '',
    },
    locations: locations || [],
    courses: courses || [],
    sectionCatalog,
    enabledSectionSlugs: [],
    sections: [],
    dataType: 'location',
    parentOptions: [],
  };
}

async function loadLocationCourseEditor(pool, id) {
  const pageRow = await getLocationCoursePageById(pool, id);
  if (!pageRow) return null;

  const editor = await loadPageEditor(pool, id, {
    dataType: 'location',
    pageRow: {
      ...pageRow,
      page_content: pageRow.content,
    },
    loadExtras: false,
    formatPage: (row) => ({
      ...row,
      page_content: row.content,
      locationPicture_url: row.locationPicture
        ? `/uploads/${UPLOAD_SUBDIR}/${row.locationPicture}`
        : null,
    }),
  });

  const [locations] = await pool.query(
    "SELECT id, location_name FROM locations WHERE status = '1' ORDER BY location_name"
  );
  const [courses] = await pool.query('SELECT id, course_name FROM courses ORDER BY course_name');

  return {
    ...editor,
    locations: locations || [],
    courses: courses || [],
  };
}

async function handlePictureUpload(existingName, files) {
  const file =
    (files || []).find((f) => f.fieldname === 'upload_file') ||
    (files || []).find((f) => f.fieldname === 'locationPicture');
  if (!file?.buffer?.length) return existingName || '';

  const uploaded = saveTimeBasenameUpload(file, uploadDir());
  if (!uploaded) return existingName || '';

  if (existingName) {
    const oldPath = path.join(uploadDir(), existingName);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  return uploaded;
}

async function createLocationCoursePage(conn, body, files) {
  const location_id = trim(body.location_id);
  const course_id = trim(body.course_id);
  const page_title = trim(body.page_title);
  const content = trim(body.content ?? body.page_content);
  let slug = normalizeSlug(body.slug);

  if (!page_title || !location_id || !course_id || !content) {
    return {
      ok: false,
      message: 'Required fields mark with * can not be left blank',
    };
  }
  if (!slug) {
    return { ok: false, message: 'Slug cannot be empty' };
  }

  const [existingCombo] = await conn.query(
    'SELECT id FROM location_course_pages WHERE location_id = ? AND course_id = ? LIMIT 1',
    [Number(location_id), Number(course_id)]
  );
  if (existingCombo?.length) {
    return { ok: false, message: 'Location-Course combination already exists' };
  }

  slug = await ensureUniqueSlug(conn, slug);
  const locationPicture = await handlePictureUpload('', files);
  const meta_description = trim(body.meta_description);
  const meta_keywords = trim(body.meta_keywords);

  const is_active = parseActiveStatus(body.is_active, 1);

  const [result] = await conn.query(
    `INSERT INTO location_course_pages
      (location_id, course_id, page_title, content, meta_description, meta_keywords, slug, locationPicture, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(location_id),
      Number(course_id),
      page_title,
      content,
      meta_description,
      meta_keywords,
      slug,
      locationPicture,
      is_active,
    ]
  );

  return {
    ok: true,
    message: 'Location-Course page added successfully',
    id: result.insertId,
  };
}

async function updateLocationCourseCore(conn, id, body, files) {
  const existing = await getLocationCoursePageById(conn, id);
  if (!existing) {
    return { ok: false, message: 'Page not found' };
  }

  const location_id = trim(body.location_id);
  const course_id = trim(body.course_id);
  const page_title = trim(body.page_title);
  const content = trim(body.content ?? body.page_content);
  let slug = normalizeSlug(body.slug);
  const is_active = parseActiveStatus(
    body.is_active,
    Number(existing?.is_active) === 1 ? 1 : 0
  );

  if (!page_title || !location_id || !course_id || !content) {
    return {
      ok: false,
      message: 'Required fields mark with * can not be left blank',
    };
  }
  if (!slug) {
    return { ok: false, message: 'Slug cannot be empty' };
  }

  const [dup] = await conn.query(
    'SELECT id FROM location_course_pages WHERE location_id = ? AND course_id = ? AND id != ? LIMIT 1',
    [Number(location_id), Number(course_id), Number(id)]
  );
  if (dup?.length) {
    return { ok: false, message: 'Location-Course combination already exists' };
  }

  slug = await ensureUniqueSlug(conn, slug, id);
  const locationPicture = await handlePictureUpload(existing.locationPicture, files);

  await conn.query(
    `UPDATE location_course_pages SET
      location_id = ?, course_id = ?, page_title = ?, content = ?,
      meta_description = ?, meta_keywords = ?, slug = ?,
      is_active = ?, locationPicture = ?
     WHERE id = ?`,
    [
      Number(location_id),
      Number(course_id),
      page_title,
      content,
      trim(body.meta_description),
      trim(body.meta_keywords),
      slug,
      is_active,
      locationPicture,
      Number(id),
    ]
  );

  return { ok: true, message: 'Location-Course page updated successfully' };
}

async function deleteLocationCoursePage(pool, id) {
  const existing = await getLocationCoursePageById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Error deleting location-course page' };
  }
  await pool.query('DELETE FROM location_course_pages WHERE id = ?', [Number(id)]);
  return { ok: true, message: 'Location-Course page deleted successfully' };
}

async function toggleLocationCourseActive(pool, id) {
  const existing = await getLocationCoursePageById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Error updating status' };
  }
  const newStatus = existing.is_active ? 0 : 1;
  await pool.query('UPDATE location_course_pages SET is_active = ? WHERE id = ?', [
    newStatus,
    Number(id),
  ]);
  return { ok: true, message: 'Status updated successfully', is_active: newStatus };
}

module.exports = {
  listLocationCoursePages,
  getLocationCoursePageById,
  loadNewLocationCourseEditor,
  loadLocationCourseEditor,
  createLocationCoursePage,
  updateLocationCourseCore,
  deleteLocationCoursePage,
  toggleLocationCourseActive,
};
