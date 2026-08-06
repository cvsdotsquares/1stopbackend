const fs = require('fs');
const path = require('path');
const { createPage, pageExistsById, seoUrl } = require('../pagesService');
const registry = require('./registry');
const {
  listInstancesForPage,
  hydrateInstance,
  getInstanceById,
  pinHomeSliderFirst,
} = require('./instanceService');
const { syncPageJunction } = require('./junctionSync');
const { isSingleUse, newUuid, nowSql, trim } = require('./constants');

const PAGE_EDITOR_FIELDS = [
  'page_title',
  'link_title',
  'slug',
  'meta_title',
  'meta_keyword',
  'meta_desc',
  'featured_display',
  'testimonial_display',
  'accreditation_display',
  'display_counter',
  'featured_service',
  'footer_link',
];

function mapPageForEditor(row) {
  return {
    id: row.id,
    page_title: row.page_title || '',
    link_title: row.link_title || '',
    slug: row.slug || '',
    meta_title: row.meta_title || '',
    meta_keyword: row.meta_keyword || '',
    meta_desc: row.meta_desc || '',
    featured_display: Number(row.featured_display) || 0,
    testimonial_display: Number(row.testimonial_display) || 0,
    accreditation_display: Number(row.accreditation_display) || 0,
    display_counter: Number(row.display_counter) || 0,
    featured_service: Number(row.featured_service) || 0,
    footer_link: Number(row.footer_link) || 0,
  };
}

async function listSectionTypes(pool, pageId = null, dataType = 'page') {
  const registered = registry.listRegisteredTypes();
  const [dbRows] = await pool.query(
    `SELECT title, title_slug FROM page_sections WHERE is_active = 1 ORDER BY id ASC`
  );
  const bySlug = new Map(registered.map((t) => [t.title_slug, t]));

  const types = [];
  for (const row of dbRows || []) {
    const slug = row.title_slug;
    if (!bySlug.has(slug)) continue;
    types.push({
      title_slug: slug,
      title: row.title || bySlug.get(slug).title,
      single_use: isSingleUse(slug),
    });
  }

  // Include registered types missing from active catalog (e.g. cms_sidebar)
  for (const t of registered) {
    if (!types.find((x) => x.title_slug === t.title_slug)) {
      types.push(t);
    }
  }

  if (pageId) {
    const instances = await listInstancesForPage(pool, pageId, dataType);
    const present = new Set(instances.map((i) => i.section_type));
    return types.map((t) => ({
      ...t,
      already_present: present.has(t.title_slug),
      available: !(t.single_use && present.has(t.title_slug)),
    }));
  }

  return types.map((t) => ({ ...t, already_present: false, available: true }));
}

async function getEditor(pool, pageId) {
  const page = await pageExistsById(pool, pageId);
  if (!page) {
    return { ok: false, message: 'Page not found' };
  }

  const instances = await listInstancesForPage(pool, pageId);
  const sections = [];
  for (const inst of instances) {
    try {
      sections.push(await hydrateInstance(pool, inst));
    } catch (err) {
      console.error(
        `[ADMIN][PAGES][EDITOR] hydrate ${inst.section_type}#${inst.id}:`,
        err.message
      );
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

  const sectionTypes = await listSectionTypes(pool, pageId);

  return {
    ok: true,
    data: {
      page: mapPageForEditor(page),
      sections,
      section_types: sectionTypes,
    },
  };
}

async function updatePageMeta(pool, pageId, pagePayload = {}) {
  const page = await pageExistsById(pool, pageId);
  if (!page) {
    return { ok: false, message: 'Page not found' };
  }

  const pageTitle = trim(pagePayload.page_title) || page.page_title;
  if (!pageTitle) {
    return { ok: false, message: 'Required fields mark with * can not be left blank' };
  }

  let slug = trim(pagePayload.slug);
  if (!slug) {
    slug = seoUrl(pageTitle);
  }

  const linkTitle = trim(pagePayload.link_title) || pageTitle;

  await pool.query(
    `UPDATE pages SET
      page_title = ?,
      link_title = ?,
      slug = ?,
      meta_title = ?,
      meta_keyword = ?,
      meta_desc = ?,
      featured_display = ?,
      testimonial_display = ?,
      accreditation_display = ?,
      display_counter = ?,
      featured_service = ?,
      footer_link = ?
     WHERE id = ?`,
    [
      pageTitle,
      linkTitle,
      slug,
      pagePayload.meta_title != null ? pagePayload.meta_title : page.meta_title,
      pagePayload.meta_keyword != null
        ? pagePayload.meta_keyword
        : page.meta_keyword,
      pagePayload.meta_desc != null ? pagePayload.meta_desc : page.meta_desc,
      Number(pagePayload.featured_display) ? 1 : 0,
      Number(pagePayload.testimonial_display) ? 1 : 0,
      Number(pagePayload.accreditation_display) ? 1 : 0,
      Number(pagePayload.display_counter) ? 1 : 0,
      Number(pagePayload.featured_service) ? 1 : 0,
      Number(pagePayload.footer_link) ? 1 : 0,
      pageId,
    ]
  );

  return { ok: true };
}

async function saveEditor(pool, pageId, body = {}) {
  const page = await pageExistsById(pool, pageId);
  if (!page) {
    return { ok: false, message: 'Page not found' };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (body.page) {
      const meta = await updatePageMeta(connection, pageId, body.page);
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
      if (!instance) continue;

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
        if (!existing) {
          continue;
        }
        const result = await handler.save(connection, instance.content_id, section.data);
        if (result && result.contentId && result.contentId !== instance.content_id) {
          await connection.query(
            `UPDATE cms_section_instances SET content_id = ?, updated_at = ? WHERE id = ?`,
            [result.contentId, stamp, instanceId]
          );
        }
      }
    }

    await pinHomeSliderFirst(connection, pageId, 'page');
    await syncPageJunction(connection, pageId, 'page');
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return getEditor(pool, pageId);
}

/**
 * Insert a section instance plus its content for a page that was just created.
 * Mirrors legacy add_page.php: page row first, then each section keyed to the
 * new page id, all inside one transaction.
 */
async function insertSectionForPage(
  connection,
  pageId,
  section,
  sortOrder,
  dataType = 'page'
) {
  const type = trim(section?.type);
  if (!registry.handlers[type]) {
    return { ok: false, message: `Unknown section type: ${type}` };
  }

  const pageType = dataType === 'location' ? 'location' : 'page';
  const handler = registry.getHandler(type);
  let contentId = await handler.createEmpty(connection, pageId, pageType);

  if (section.data && typeof section.data === 'object') {
    const result = await handler.save(connection, contentId, section.data);
    if (result && result.ok === false) {
      return result;
    }
    if (result && result.contentId) {
      contentId = result.contentId;
    }
  }

  const status = section.status === 'draft' ? 'draft' : 'published';
  const isEnabled = section.is_enabled === false ? 0 : 1;
  const adminLabel = section.admin_label ? trim(section.admin_label) : null;
  const stamp = nowSql();

  await connection.query(
    `INSERT INTO cms_section_instances (
      uuid, page_id, data_type, section_type, content_id, sort_order,
      admin_label, status, is_enabled, legacy_junction_id, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    [
      newUuid(),
      pageId,
      pageType,
      type,
      contentId,
      sortOrder,
      adminLabel,
      status,
      isEnabled,
      stamp,
      stamp,
    ]
  );

  return { ok: true };
}

/** Create the page and all of its sections in a single transaction. */
async function createPageWithSections(pool, body = {}) {
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

    const created = await createPage(connection, body.page || {}, null);
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
        sortOrder
      );
      if (!result.ok) {
        await connection.rollback();
        return result;
      }
    }

    await syncPageJunction(connection, pageId, 'page');
    await connection.commit();

    return {
      ok: true,
      message: created.message || 'Page added successfully',
      data: { id: pageId, sections: orderedSections.length },
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

function getUploadsDir() {
  const base =
    process.env.FRONT_IMG_DIR || path.join(process.cwd(), 'uploads');
  const uploadsDir = path.join(base, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  return uploadsDir;
}

async function removeImage(pool, { filename, folder, instanceId, pageId, field } = {}) {
  const name = trim(filename);
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return { ok: false, message: 'Invalid filename' };
  }

  const folderName = trim(folder);
  const target = folderName
    ? path.join(getUploadsDir(), folderName, name)
    : path.join(getUploadsDir(), name);

  if (fs.existsSync(target)) {
    try {
      fs.unlinkSync(target);
    } catch (err) {
      console.error('[ADMIN][PAGES][REMOVE_IMAGE]', err.message);
    }
  }

  // Optional: clear field on content if provided
  if (instanceId && pageId && field) {
    const instance = await getInstanceById(pool, instanceId, pageId);
    if (instance) {
      const handler = registry.getHandler(instance.section_type);
      const data = await handler.load(pool, instance.content_id);
      if (data && Object.prototype.hasOwnProperty.call(data, field)) {
        await handler.save(pool, instance.content_id, { ...data, [field]: '' });
      }
    }
  }

  return { ok: true, message: 'Image removed' };
}

module.exports = {
  getEditor,
  saveEditor,
  createPageWithSections,
  insertSectionForPage,
  listSectionTypes,
  updatePageMeta,
  removeImage,
  PAGE_EDITOR_FIELDS,
};
