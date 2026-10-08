const fs = require('fs');
const path = require('path');
const {
  getCmsPublicPathsByPageIds,
  getCmsPublicPathForPageId,
  normalizeStoredPageSlug,
} = require('../../utils/cmsPageResolver');
const { validatePageRequiredFields } = require('./pageFormValidation');

/** Legacy pages.php uses 1000 records per page. */
const RECORDS_PER_PAGE = 1000;

const LIST_EXCLUDE_IDS = new Set([9, 78, 73]);
const DELETE_BLOCKED_IDS = new Set([58, 73, 77, 78, 96]);
const NAV_NOT_REQUIRED_SENTINEL = 854698;
const ADMIN_PAGE_HOME_ID = 9;
/** 1 = published (live), 0 = draft (preview only). */
const PAGE_STATUS_PUBLISHED = 1;
const PAGE_STATUS_DRAFT = 0;

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function normalizePageStatus(value) {
  if (value === undefined || value === null || value === '') {
    return PAGE_STATUS_PUBLISHED;
  }
  return Number(value) === PAGE_STATUS_DRAFT ? PAGE_STATUS_DRAFT : PAGE_STATUS_PUBLISHED;
}

function parsePageStatusFromBody(body) {
  const v = body?.status;
  if (v === '0' || v === 0 || v === false || v === 'false') {
    return PAGE_STATUS_DRAFT;
  }
  if (v === '1' || v === 1 || v === true || v === 'true') {
    return PAGE_STATUS_PUBLISHED;
  }
  return PAGE_STATUS_DRAFT;
}

function seoUrl(string) {
  let s = trim(string);
  s = s.replace(/\./g, '-');
  s = s.replace(/amp;/g, '');
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9_\s-]/g, '');
  s = s.replace(/[\s-]+/g, ' ');
  s = s.replace(/[\s_]/g, '-');
  s = s.replace(/^-+/, '');
  return s;
}

function mapListRow(row) {
  return {
    id: Number(row.id),
    page_title: row.page_title,
    link_title: row.link_title,
    slug: row.slug,
    cms_path: row.cms_path ?? row.slug ?? '',
    status: normalizePageStatus(row.status),
    is_parent: Number(row.is_parent),
    parent_level: Number(row.parent_level),
    weight: row.weight,
    child_count: Number(row.pcnt) || 0,
    featured_service: Number(row.featured_service) || 0,
  };
}

function buildListWhere(searchterm) {
  let where = " WHERE pages.id != '' ";
  const params = [];
  const nameScr = trim(searchterm?.name_scr);
  if (nameScr) {
    where += ' AND pages.page_title LIKE ?';
    params.push(`%${nameScr}%`);
  }
  return { where, params };
}

async function listPages(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const { where, params } = buildListWhere(searchterm);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM pages ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT featured_service, id, page_title, link_title, slug, status, is_parent, parent_level, weight,
      (SELECT count(*) FROM pages pg WHERE pg.is_parent = pages.id) AS pcnt
     FROM pages ${where}
     ORDER BY pages.is_parent, weight
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  const relArr = [];
  const byId = new Map();

  for (const row of rows || []) {
    byId.set(Number(row.id), mapListRow(row));
  }

  for (const row of rows || []) {
    const m = byId.get(Number(row.id));
    if (!m) continue;
    if (LIST_EXCLUDE_IDS.has(m.id)) continue;

    if (m.is_parent === 0) {
      relArr.push(m);
      if (m.child_count > 0) {
        for (const mt of rows || []) {
          const child = byId.get(Number(mt.id));
          if (child && child.is_parent === m.id) {
            relArr.push(child);
            if (child.child_count > 0) {
              for (const mtt of rows || []) {
                const grand = byId.get(Number(mtt.id));
                if (grand && grand.is_parent === child.id) {
                  relArr.push(grand);
                }
              }
            }
          }
        }
      }
    } else if (!relArr.some((r) => r.id === m.id)) {
      relArr.push(m);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / RECORDS_PER_PAGE));

  const cmsPathByPageId = await getCmsPublicPathsByPageIds(
    pool,
    relArr.map((row) => row.id)
  );
  for (const row of relArr) {
    row.cms_path = cmsPathByPageId.get(row.id) ?? row.slug ?? '';
  }

  let homePageMeta = { id: 9, label: 'Home', slug: '', cms_path: '' };
  const homeRow = await getPageById(pool, ADMIN_PAGE_HOME_ID);
  if (homeRow) {
    const homeCmsPath = await getCmsPublicPathForPageId(pool, ADMIN_PAGE_HOME_ID);
    homePageMeta = {
      id: ADMIN_PAGE_HOME_ID,
      label: homeRow.page_title || 'Home',
      slug: homeRow.slug || '',
      cms_path: homeCmsPath,
    };
  }

  return {
    home_page: homePageMeta,
    items: relArr,
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages,
    },
    filters: { name_scr: trim(searchterm?.name_scr) },
  };
}

async function getPageById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM pages WHERE id = ? LIMIT 1', [id]);
  return rows?.[0] || null;
}

async function slugExists(pool, slug, excludeId = null) {
  const params = [slug];
  let sql = 'SELECT id FROM pages WHERE slug = ?';
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const [rows] = await pool.query(sql, params);
  return Boolean(rows?.[0]);
}

function parseParentSelection(isParentRaw) {
  const raw = trim(isParentRaw);
  if (raw === 'no_navigation') {
    return { is_parent: NAV_NOT_REQUIRED_SENTINEL, parent_level: NAV_NOT_REQUIRED_SENTINEL };
  }
  if (!raw || raw === '0') {
    return { is_parent: 0, parent_level: 0 };
  }
  const parts = raw.split('-');
  const parentId = Number(parts[0]) || 0;
  const level = Number(parts[1]);
  return {
    is_parent: parentId,
    parent_level: Number.isFinite(level) ? level + 1 : 0,
  };
}

async function getParentPageOptions(pool) {
  const [rows] = await pool.query(
    `SELECT Page.id, Page.is_parent, Page.parent_level, Page.page_title, Page.link_title,
      (SELECT count(*) FROM pages pg WHERE pg.is_parent = Page.id) AS pcnt
     FROM pages AS Page
     WHERE Page.parent_level != 2
     ORDER BY Page.id ASC`
  );
  return (rows || []).map((r) => ({
    id: Number(r.id),
    is_parent: Number(r.is_parent),
    parent_level: Number(r.parent_level),
    page_title: r.page_title,
    link_title: r.link_title,
    child_count: Number(r.pcnt) || 0,
  }));
}

async function getSectionCatalog(pool) {
  const [rows] = await pool.query(
    'SELECT id, title, title_slug FROM page_sections WHERE is_active = 1 ORDER BY sort_order ASC'
  );
  return (rows || []).map((r) => ({
    id: Number(r.id),
    title: r.title,
    title_slug: r.title_slug,
  }));
}

async function createPage(pool, body) {
  const requiredCheck = validatePageRequiredFields(body);
  if (!requiredCheck.ok) {
    return {
      ok: false,
      message: requiredCheck.message,
      missingFields: requiredCheck.missingFields,
    };
  }

  let slug = normalizeStoredPageSlug(body.slug) || seoUrl(body.page_title);
  if (await slugExists(pool, slug)) {
    return { ok: false, message: 'Another page already exits with same page name' };
  }

  let { is_parent, parent_level } = parseParentSelection(body.is_parent);

  const overlay = parseBannerOverlay(body);

  const [result] = await pool.query(
    `INSERT INTO pages (
      is_parent, page_title, page_content, internal_css, meta_title, meta_keyword, meta_desc,
      parent_level, slug, link_title, banner_type, overlay_caption, overlay_caption_text,
      carousel_static_image, carousel_static_caption, page_ex_rhs, weight,
      featured_service, footer_link, featured_icon, testimonial_display, featured_display,
      accreditation_display, display_counter, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      is_parent,
      trim(body.page_title),
      body.page_content ?? '',
      body.internal_css ?? '',
      body.meta_title ?? '',
      body.meta_keyword ?? '',
      body.meta_desc ?? '',
      parent_level,
      slug,
      trim(body.link_title),
      Number(body.banner_type) || 0,
      overlay.overlay_caption,
      overlay.overlay_caption_text,
      '',
      trim(body.carousel_static_caption),
      body.page_ex_rhs ?? '',
      trim(body.weight) || 0,
      body.featured_service ? 1 : 0,
      body.footer_link ? 1 : 0,
      trim(body.featured_icon),
      body.testimonial_display ? 1 : 0,
      body.featured_display ? 1 : 0,
      body.accreditation_display ? 1 : 0,
      body.display_counter ? 1 : 0,
      body.status !== undefined && body.status !== ''
        ? parsePageStatusFromBody(body)
        : PAGE_STATUS_PUBLISHED,
    ]
  );

  return { ok: true, id: result.insertId, message: 'Page added successfully' };
}

async function updatePageStatus(pool, id, status) {
  const pageId = Number(id);
  if (!Number.isFinite(pageId) || pageId <= 0) {
    return { ok: false, message: 'Page not found' };
  }
  if (pageId === ADMIN_PAGE_HOME_ID) {
    return { ok: false, message: 'Home page cannot be unpublished' };
  }

  const nextStatus = normalizePageStatus(status);
  const existing = await getPageById(pool, pageId);
  if (!existing) {
    return { ok: false, message: 'Page not found' };
  }

  const [result] = await pool.query('UPDATE pages SET status = ? WHERE id = ?', [
    nextStatus,
    pageId,
  ]);

  if (!result?.affectedRows) {
    return { ok: false, message: 'Error in change status' };
  }

  return { ok: true, message: 'Page status changed successfully', status: nextStatus };
}

function parseBannerOverlay(body) {
  let overlay_caption = 0;
  let overlay_caption_text = '';
  if (Number(body.banner_type) > 0 && (body.overlay_caption === '1' || body.overlay_caption === 1 || body.overlay_caption === true)) {
    overlay_caption = 1;
    overlay_caption_text = body.overlay_caption_text ?? '';
  }
  return { overlay_caption, overlay_caption_text };
}

async function updatePageWeight(pool, id, weight) {
  const w = trim(weight);
  const val = w === '' ? 0 : Number(w);
  if (!Number.isFinite(val)) {
    return { ok: false, message: 'Error in change position' };
  }
  const [result] = await pool.query('UPDATE pages SET weight = ? WHERE id = ?', [val, id]);
  if (result.affectedRows > 0) {
    return { ok: true };
  }
  return { ok: false, message: 'Error in change position' };
}

async function deletePage(pool, id) {
  const pageId = Number(id);
  if (!Number.isFinite(pageId) || pageId <= 0) {
    return { ok: false, message: 'Page not found to delete' };
  }
  if (DELETE_BLOCKED_IDS.has(pageId)) {
    return { ok: false, message: 'Error in deleting page' };
  }

  const page = await getPageById(pool, pageId);
  if (!page) {
    return { ok: false, message: 'Page not found to delete' };
  }

  const [childRows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM pages WHERE is_parent = ?',
    [pageId]
  );
  const childCount = Number(childRows?.[0]?.cnt) || 0;
  if (childCount > 0) {
    return { ok: false, message: 'Error in deleting page' };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM pages WHERE id = ?', [pageId]);

    if (Number(page.parent_level) < 2) {
      const [tls] = await conn.query(
        'SELECT id, parent_level FROM pages WHERE is_parent = ?',
        [pageId]
      );
      for (const tl of tls || []) {
        await conn.query('DELETE FROM pages WHERE id = ?', [tl.id]);
        if (Number(tl.parent_level) === 1) {
          await conn.query('DELETE FROM pages WHERE is_parent = ?', [tl.id]);
        }
      }
    }

    await conn.commit();
    return { ok: true, message: 'Page deleted successfully' };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function getUploadsBaseDir() {
  const base =
    process.env.FRONT_IMG_DIR || path.join(process.cwd(), 'uploads');
  const uploads = path.join(base, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  return uploads;
}

function getCarouselPublicUrl(req, filename) {
  if (!filename) return null;
  const { getSiteUrl } = require('../utils/siteUrl');
  const site = getSiteUrl(req);
  if (site) {
    return `${site.replace(/\/$/, '')}/uploads/${filename}`;
  }
  return `/uploads/${filename}`;
}

module.exports = {
  RECORDS_PER_PAGE,
  LIST_EXCLUDE_IDS,
  DELETE_BLOCKED_IDS,
  NAV_NOT_REQUIRED_SENTINEL,
  seoUrl,
  listPages,
  getPageById,
  slugExists,
  parseParentSelection,
  getParentPageOptions,
  getSectionCatalog,
  createPage,
  updatePageWeight,
  deletePage,
  getUploadsBaseDir,
  getCarouselPublicUrl,
  parseBannerOverlay,
  getCmsPublicPathForPageId,
  normalizePageStatus,
  parsePageStatusFromBody,
  updatePageStatus,
  PAGE_STATUS_PUBLISHED,
  PAGE_STATUS_DRAFT,
  ADMIN_PAGE_HOME_ID,
};
