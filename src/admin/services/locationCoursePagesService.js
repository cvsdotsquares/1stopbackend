const fs = require('fs');
const path = require('path');
const {
  listInstancesForPage,
  hydrateInstance,
  getInstanceById,
  pinHomeSliderFirst,
  addSection,
  reorderSections,
} = require('./pageSections/instanceService');
const {
  listSectionTypes,
  insertSectionForPage,
  removeImage,
} = require('./pageSections/editorService');
const { syncPageJunction } = require('./pageSections/junctionSync');
const registry = require('./pageSections/registry');
const { isSingleUse, nowSql, trim } = require('./pageSections/constants');

const DATA_TYPE = 'location';
const RECORDS_PER_PAGE = 20;
const ALLOWED_FILE_EXT = new Set([
  'pdf',
  'doc',
  'docx',
  'jpg',
  'jpeg',
  'png',
  'gif',
]);

function getUploadsDir() {
  const base =
    process.env.FRONT_IMG_DIR || path.join(process.cwd(), 'uploads');
  const uploadsDir = path.join(base, 'uploads', 'location_course_files');
  fs.mkdirSync(uploadsDir, { recursive: true });
  return uploadsDir;
}

function normalizeSlug(raw) {
  let slug = trim(raw).toLowerCase();
  slug = slug.replace(/\s+/g, '-');
  slug = slug.replace(/[^a-z0-9-]/g, '');
  slug = slug.replace(/-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  return slug;
}

async function ensureUniqueSlug(pool, baseSlug, excludeId = null) {
  let slug = baseSlug;
  let n = 1;
  for (;;) {
    let sql = 'SELECT id FROM location_course_pages WHERE slug = ?';
    const params = [slug];
    if (excludeId != null) {
      sql += ' AND id != ?';
      params.push(excludeId);
    }
    sql += ' LIMIT 1';
    const [rows] = await pool.query(sql, params);
    if (!rows.length) return slug;
    slug = `${baseSlug}-${n}`;
    n += 1;
  }
}

async function comboExists(pool, locationId, courseId, excludeId = null) {
  let sql =
    'SELECT id FROM location_course_pages WHERE location_id = ? AND course_id = ?';
  const params = [locationId, courseId];
  if (excludeId != null) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const [rows] = await pool.query(sql, params);
  return Boolean(rows.length);
}

function saveLocationPicture(file) {
  if (!file || !file.originalname) {
    return { ok: true, filename: '' };
  }
  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED_FILE_EXT.has(ext)) {
    return { ok: false, message: 'File type is not allowed' };
  }
  const safeBase = path
    .basename(file.originalname, path.extname(file.originalname))
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);
  const filename = `${Date.now()}_${safeBase}.${ext}`;
  fs.writeFileSync(path.join(getUploadsDir(), filename), file.buffer);
  return { ok: true, filename };
}

function mapListRow(row) {
  return {
    id: row.id,
    location_id: row.location_id,
    course_id: row.course_id,
    location_name: row.location_name || '',
    course_name: row.course_name || '',
    page_title: row.page_title || '',
    slug: row.slug || '',
    is_active: Number(row.is_active) ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapDetailRow(row) {
  return {
    id: row.id,
    location_id: row.location_id,
    course_id: row.course_id,
    location_name: row.location_name || '',
    course_name: row.course_name || '',
    page_title: row.page_title || '',
    content: row.content || '',
    meta_description: row.meta_description || '',
    meta_keywords: row.meta_keywords || '',
    slug: row.slug || '',
    locationPicture: row.locationPicture || '',
    is_active: Number(row.is_active) ? 1 : 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listLocationCoursePages(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const nameScr = trim(searchterm.name_scr);
  const locationFilter = trim(searchterm.location_filter);
  const courseFilter = trim(searchterm.course_filter);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  let where = ' WHERE 1=1 ';
  const params = [];
  if (nameScr) {
    where +=
      ' AND (lcp.page_title LIKE ? OR lcp.content LIKE ? OR l.location_name LIKE ? OR c.course_name LIKE ?)';
    params.push(`%${nameScr}%`, `%${nameScr}%`, `%${nameScr}%`, `%${nameScr}%`);
  }
  if (locationFilter) {
    where += ' AND lcp.location_id = ?';
    params.push(Number(locationFilter));
  }
  if (courseFilter) {
    where += ' AND lcp.course_id = ?';
    params.push(Number(courseFilter));
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM location_course_pages lcp
     LEFT JOIN locations l ON lcp.location_id = l.id
     LEFT JOIN courses c ON lcp.course_id = c.id
     ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT lcp.*, l.location_name, c.course_name
     FROM location_course_pages lcp
     LEFT JOIN locations l ON lcp.location_id = l.id
     LEFT JOIN courses c ON lcp.course_id = c.id
     ${where}
     ORDER BY lcp.id DESC
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  return {
    items: (rows || []).map(mapListRow),
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: {
      name_scr: nameScr,
      location_filter: locationFilter,
      course_filter: courseFilter,
    },
  };
}

async function getLocationCoursePageById(pool, id) {
  const [rows] = await pool.query(
    `SELECT lcp.*, l.location_name, c.course_name
     FROM location_course_pages lcp
     LEFT JOIN locations l ON lcp.location_id = l.id
     LEFT JOIN courses c ON lcp.course_id = c.id
     WHERE lcp.id = ?
     LIMIT 1`,
    [id]
  );
  return rows?.[0] ? mapDetailRow(rows[0]) : null;
}

async function resolveNames(pool, locationId, courseId) {
  const [[locRows], [courseRows]] = await Promise.all([
    pool.query(
      'SELECT location_name FROM locations WHERE id = ? LIMIT 1',
      [locationId]
    ),
    pool.query('SELECT course_name FROM courses WHERE id = ? LIMIT 1', [
      courseId,
    ]),
  ]);
  return {
    location_name: locRows?.[0]?.location_name || '',
    course_name: courseRows?.[0]?.course_name || '',
  };
}

async function createLocationCoursePage(pool, body = {}, file = null) {
  const pageTitle = trim(body.page_title);
  const locationId = Number(body.location_id);
  const courseId = Number(body.course_id);
  const content = trim(body.content);

  if (
    !pageTitle ||
    !Number.isFinite(locationId) ||
    locationId <= 0 ||
    !Number.isFinite(courseId) ||
    courseId <= 0 ||
    !content
  ) {
    return {
      ok: false,
      message: 'Required fields mark with * can not be left blank',
    };
  }

  if (await comboExists(pool, locationId, courseId)) {
    return {
      ok: false,
      message: 'A page already exists for this location-course combination',
    };
  }

  const names = await resolveNames(pool, locationId, courseId);
  let slug = normalizeSlug(body.slug);
  if (!slug) {
    slug = normalizeSlug(
      `${names.course_name || 'course'}-${names.location_name || 'location'}`
    );
  }
  if (!slug) {
    return { ok: false, message: 'Slug cannot be empty' };
  }
  slug = await ensureUniqueSlug(pool, slug);

  let locationPicture = '';
  if (file) {
    const upload = saveLocationPicture(file);
    if (!upload.ok) return upload;
    locationPicture = upload.filename;
  }

  const isActive =
    body.is_active === undefined || body.is_active === null
      ? 1
      : Number(body.is_active)
        ? 1
        : 0;

  const [result] = await pool.query(
    `INSERT INTO location_course_pages (
      location_id, course_id, page_title, content, meta_description, meta_keywords,
      slug, locationPicture, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      locationId,
      courseId,
      pageTitle,
      content,
      body.meta_description != null ? String(body.meta_description) : '',
      trim(body.meta_keywords),
      slug,
      locationPicture,
      isActive,
    ]
  );

  return {
    ok: true,
    message: 'Location course page added successfully',
    data: { id: result.insertId, slug },
  };
}

async function updateLocationCoursePage(pool, id, body = {}, file = null) {
  const existing = await getLocationCoursePageById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Page not found' };
  }

  const pageTitle = trim(body.page_title) || existing.page_title;
  const locationId = Number(
    body.location_id != null ? body.location_id : existing.location_id
  );
  const courseId = Number(
    body.course_id != null ? body.course_id : existing.course_id
  );
  const content =
    body.content != null ? String(body.content) : existing.content;

  if (
    !pageTitle ||
    !Number.isFinite(locationId) ||
    locationId <= 0 ||
    !Number.isFinite(courseId) ||
    courseId <= 0 ||
    !trim(content)
  ) {
    return {
      ok: false,
      message: 'Required fields mark with * can not be left blank',
    };
  }

  if (await comboExists(pool, locationId, courseId, id)) {
    return {
      ok: false,
      message: 'A page already exists for this location-course combination',
    };
  }

  const names = await resolveNames(pool, locationId, courseId);
  let slug = normalizeSlug(body.slug != null ? body.slug : existing.slug);
  if (!slug) {
    slug = normalizeSlug(
      `${names.course_name || 'course'}-${names.location_name || 'location'}`
    );
  }
  if (!slug) {
    return { ok: false, message: 'Slug cannot be empty' };
  }
  slug = await ensureUniqueSlug(pool, slug, id);

  let locationPicture = existing.locationPicture || '';
  if (file) {
    const upload = saveLocationPicture(file);
    if (!upload.ok) return upload;
    locationPicture = upload.filename;
  } else if (Object.prototype.hasOwnProperty.call(body, 'locationPicture')) {
    locationPicture = trim(body.locationPicture);
  }

  const isActive = Object.prototype.hasOwnProperty.call(body, 'is_active')
    ? Number(body.is_active)
      ? 1
      : 0
    : existing.is_active;

  await pool.query(
    `UPDATE location_course_pages SET
      location_id = ?, course_id = ?, page_title = ?, content = ?,
      meta_description = ?, meta_keywords = ?, slug = ?, locationPicture = ?,
      is_active = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      locationId,
      courseId,
      pageTitle,
      content,
      body.meta_description != null
        ? String(body.meta_description)
        : existing.meta_description,
      body.meta_keywords != null
        ? trim(body.meta_keywords)
        : existing.meta_keywords,
      slug,
      locationPicture,
      isActive,
      id,
    ]
  );

  return {
    ok: true,
    message: 'Location course page updated successfully',
    data: { id, slug },
  };
}

async function toggleLocationCoursePageActive(pool, id) {
  const [rows] = await pool.query(
    'SELECT id, is_active FROM location_course_pages WHERE id = ? LIMIT 1',
    [id]
  );
  if (!rows.length) {
    return { ok: false, message: 'Page not found' };
  }
  const next = Number(rows[0].is_active) ? 0 : 1;
  await pool.query(
    'UPDATE location_course_pages SET is_active = ?, updated_at = NOW() WHERE id = ?',
    [next, id]
  );
  return {
    ok: true,
    message: next ? 'Page activated' : 'Page deactivated',
    data: { id, is_active: next },
  };
}

async function deleteLocationCoursePage(pool, id) {
  const existing = await getLocationCoursePageById(pool, id);
  if (!existing) {
    return { ok: false, message: 'Page not found to delete' };
  }

  await pool.query(
    `DELETE FROM page_junction WHERE data_id = ? AND data_type = ?`,
    [id, DATA_TYPE]
  );
  await pool.query(
    `DELETE FROM cms_section_instances WHERE page_id = ? AND data_type = ?`,
    [id, DATA_TYPE]
  );
  await pool.query('DELETE FROM location_course_pages WHERE id = ?', [id]);

  return { ok: true, message: 'Page deleted successfully' };
}

async function getLocationEditor(pool, pageId) {
  const page = await getLocationCoursePageById(pool, pageId);
  if (!page) {
    return { ok: false, message: 'Page not found' };
  }

  const instances = await listInstancesForPage(pool, pageId, DATA_TYPE);
  const sections = [];
  for (const inst of instances) {
    try {
      sections.push(await hydrateInstance(pool, inst));
    } catch (err) {
      sections.push({
        id: inst.id,
        uuid: inst.uuid,
        type: inst.section_type,
        title: inst.section_type,
        content_id: inst.content_id,
        sort_order: Number(inst.sort_order) || 0,
        admin_label: inst.admin_label,
        status: inst.status,
        is_enabled: Number(inst.is_enabled) === 1,
        single_use: isSingleUse(inst.section_type),
        data: null,
        load_error: err.message,
      });
    }
  }

  const sectionTypes = await listSectionTypes(pool, pageId, DATA_TYPE);

  return {
    ok: true,
    data: {
      page,
      sections,
      section_types: sectionTypes,
    },
  };
}

async function saveLocationEditor(pool, pageId, body = {}) {
  const page = await getLocationCoursePageById(pool, pageId);
  if (!page) {
    return { ok: false, message: 'Page not found' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (body.page) {
      const meta = await updateLocationCoursePage(connection, pageId, body.page);
      if (!meta.ok) {
        await connection.rollback();
        return meta;
      }
    }

    const sections = Array.isArray(body.sections) ? body.sections : [];
    for (const section of sections) {
      const instanceId = Number(section.id);
      if (!Number.isFinite(instanceId)) continue;

      const instance = await getInstanceById(connection, instanceId, pageId);
      if (!instance || instance.data_type !== DATA_TYPE) continue;

      const stamp = nowSql();
      const patchParts = [];
      const patchParams = [];

      if (Object.prototype.hasOwnProperty.call(section, 'admin_label')) {
        patchParts.push('admin_label = ?');
        patchParams.push(section.admin_label);
      }
      if (Object.prototype.hasOwnProperty.call(section, 'status')) {
        if (['draft', 'published'].includes(section.status)) {
          patchParts.push('status = ?');
          patchParams.push(section.status);
        }
      }
      if (Object.prototype.hasOwnProperty.call(section, 'is_enabled')) {
        patchParts.push('is_enabled = ?');
        patchParams.push(section.is_enabled ? 1 : 0);
      }
      if (Object.prototype.hasOwnProperty.call(section, 'sort_order')) {
        patchParts.push('sort_order = ?');
        patchParams.push(Number(section.sort_order) || 0);
      }

      if (patchParts.length) {
        patchParts.push('updated_at = ?');
        patchParams.push(stamp);
        patchParams.push(instanceId, pageId);
        await connection.query(
          `UPDATE cms_section_instances SET ${patchParts.join(', ')}
           WHERE id = ? AND page_id = ? AND deleted_at IS NULL`,
          patchParams
        );
      }

      if (section.data && typeof section.data === 'object') {
        const handler = registry.getHandler(instance.section_type);
        const existing = await handler.load(connection, instance.content_id);
        if (!existing) continue;
        const result = await handler.save(
          connection,
          instance.content_id,
          section.data
        );
        if (
          result &&
          result.contentId &&
          result.contentId !== instance.content_id
        ) {
          await connection.query(
            `UPDATE cms_section_instances SET content_id = ?, updated_at = ? WHERE id = ?`,
            [result.contentId, stamp, instanceId]
          );
        }
      }
    }

    await pinHomeSliderFirst(connection, pageId, DATA_TYPE);
    await syncPageJunction(connection, pageId, DATA_TYPE);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return getLocationEditor(pool, pageId);
}

async function createLocationPageWithSections(pool, body = {}, file = null) {
  const sections = Array.isArray(body.sections) ? body.sections : [];
  const orderedSections = [
    ...sections.filter((section) => trim(section?.type) === 'home_slider'),
    ...sections.filter((section) => trim(section?.type) !== 'home_slider'),
  ];
  const seenSingleUse = new Set();

  for (const section of sections) {
    const type = trim(section?.type);
    if (!registry.handlers[type]) {
      return { ok: false, message: `Unknown section type: ${type}` };
    }
    if (isSingleUse(type)) {
      if (seenSingleUse.has(type)) {
        return {
          ok: false,
          message: `${type} can only be added once per page`,
        };
      }
      seenSingleUse.add(type);
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const created = await createLocationCoursePage(
      connection,
      body.page || {},
      file
    );
    if (!created.ok) {
      await connection.rollback();
      return created;
    }

    const pageId = created.data.id;
    let sortOrder = 0;
    for (const section of orderedSections) {
      sortOrder += 1;
      const result = await insertSectionForPage(
        connection,
        pageId,
        section,
        sortOrder,
        DATA_TYPE
      );
      if (!result.ok) {
        await connection.rollback();
        return result;
      }
    }

    await pinHomeSliderFirst(connection, pageId, DATA_TYPE);
    await syncPageJunction(connection, pageId, DATA_TYPE);
    await connection.commit();

    return {
      ok: true,
      message: created.message || 'Location course page added successfully',
      data: {
        id: pageId,
        slug: created.data.slug,
        sections: orderedSections.length,
      },
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  DATA_TYPE,
  listLocationCoursePages,
  getLocationCoursePageById,
  createLocationCoursePage,
  updateLocationCoursePage,
  toggleLocationCoursePageActive,
  deleteLocationCoursePage,
  getLocationEditor,
  saveLocationEditor,
  createLocationPageWithSections,
  listSectionTypes,
  addSection,
  reorderSections,
  removeImage,
  normalizeSlug,
};
