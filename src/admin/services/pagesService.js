const fs = require('fs');
const path = require('path');

const RECORDS_PER_PAGE = 1000;
const HOME_PAGE_ID = 9;
const NO_NAVIGATION_PARENT = 854698;
const LIST_SKIP_IDS = new Set([HOME_PAGE_ID, 73, 78]);
const PROTECTED_DELETE_IDS = new Set([58, 73, 77, 78, 96]);
const ALLOWED_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif']);

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function seoUrl(string) {
  let slug = trim(string).replace(/\./g, '-').replace(/amp;/g, '').toLowerCase();
  slug = slug.replace(/[^a-z0-9_\s-]/g, '');
  slug = slug.replace(/[\s-]+/g, ' ');
  slug = slug.replace(/[\s_]/g, '-');
  slug = slug.replace(/^-+/, '').replace(/-+$/, '');
  return slug;
}

function getUploadsDir() {
  // Legacy: FRONT_IMG_DIR . 'uploads'
  const base =
    process.env.FRONT_IMG_DIR || path.join(process.cwd(), 'uploads');
  const uploadsDir = path.join(base, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  return uploadsDir;
}

function saveUploadedBanner(file) {
  if (!file || !file.originalname) {
    return { ok: true, filename: '' };
  }

  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    return {
      ok: false,
      message: 'File type is not correct for carousel_static_image',
    };
  }

  // Legacy filesUpload naming: {field}_{microtime}.{ext}
  const filename = `carousel_static_image_${Math.round(Date.now() / 1000)}.${ext}`;
  const target = path.join(getUploadsDir(), filename);
  fs.writeFileSync(target, file.buffer);
  return { ok: true, filename };
}

function mapPageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    page_title: row.page_title,
    link_title: row.link_title,
    slug: row.slug,
    is_parent: row.is_parent,
    parent_level: row.parent_level,
    weight: row.weight,
    child_count: Number(row.pcnt) || 0,
    featured_service: Number(row.featured_service) || 0,
  };
}

/** Match legacy Page::getPages() hierarchical array build. */
function orderPagesHierarchically(rows) {
  const relMap = new Map();

  for (const m of rows) {
    if (Number(m.is_parent) === 0) {
      relMap.set(m.id, m);
      if (Number(m.pcnt) > 0) {
        for (const mt of rows) {
          if (Number(m.id) === Number(mt.is_parent)) {
            relMap.set(mt.id, mt);
            if (Number(mt.pcnt) > 0) {
              for (const mtt of rows) {
                if (Number(mt.id) === Number(mtt.is_parent)) {
                  relMap.set(mtt.id, mtt);
                }
              }
            }
          }
        }
      }
    } else {
      relMap.set(m.id, m);
    }
  }

  return Array.from(relMap.values());
}

function buildListWhere(nameScr) {
  let where = " WHERE pages.id != '' ";
  const params = [];

  if (nameScr) {
    where += ' AND pages.page_title LIKE ?';
    params.push(`%${nameScr}%`);
  }

  return { where, params };
}

async function listPages(pool, { page = 1, searchterm = {} } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const nameScr = trim(searchterm?.name_scr);
  const { where, params } = buildListWhere(nameScr);
  const offset = (pageNum - 1) * RECORDS_PER_PAGE;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM pages ${where}`,
    params
  );
  const total = Number(countRows?.[0]?.total) || 0;

  const [rows] = await pool.query(
    `SELECT featured_service, id, page_title, is_parent, parent_level, weight, link_title,
      (SELECT COUNT(*) FROM pages pg WHERE pg.is_parent = pages.id) AS pcnt
     FROM pages ${where}
     ORDER BY pages.is_parent, weight
     LIMIT ?, ?`,
    [...params, offset, RECORDS_PER_PAGE]
  );

  const ordered = orderPagesHierarchically(rows || []);
  const items = ordered
    .filter((row) => !LIST_SKIP_IDS.has(Number(row.id)))
    .map(mapPageRow);

  let homePage = null;
  const [homeRows] = await pool.query(
    `SELECT featured_service, id, page_title, is_parent, parent_level, weight, link_title,
      (SELECT COUNT(*) FROM pages pg WHERE pg.is_parent = pages.id) AS pcnt
     FROM pages WHERE id = ? LIMIT 1`,
    [HOME_PAGE_ID]
  );
  if (homeRows?.[0]) {
    homePage = mapPageRow(homeRows[0]);
  }

  return {
    home_page: homePage,
    items,
    pagination: {
      page: pageNum,
      perPage: RECORDS_PER_PAGE,
      total,
      totalPages: Math.max(1, Math.ceil(total / RECORDS_PER_PAGE)),
    },
    filters: {
      name_scr: nameScr,
    },
  };
}

async function getParentPageOptions(pool) {
  const [rows] = await pool.query(`
    SELECT Page.id, Page.is_parent, Page.parent_level, Page.page_title, Page.link_title,
      (SELECT COUNT(*) FROM pages pg WHERE pg.is_parent = Page.id) AS pcnt
    FROM pages AS Page
    WHERE Page.parent_level != 2
    ORDER BY Page.id ASC
  `);

  const options = [{ value: '0', label: 'Own Parent', level: 0 }];

  for (const m of rows || []) {
    if (Number(m.is_parent) !== 0) continue;

    options.push({
      value: `${m.id}-${m.parent_level}`,
      label: m.link_title || m.page_title,
      level: 0,
    });

    if (Number(m.pcnt) > 0) {
      for (const mt of rows) {
        if (Number(m.id) === Number(mt.is_parent)) {
          options.push({
            value: `${mt.id}-${mt.parent_level}`,
            label: `-------${mt.link_title || mt.page_title}`,
            level: 1,
          });
        }
      }
    }
  }

  options.push({
    value: 'no_navigation',
    label: 'Navigation Not Required',
    level: -1,
  });

  return options;
}

async function pageExistsById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM pages WHERE id = ? LIMIT 1', [
    id,
  ]);
  return rows?.[0] || null;
}

async function pageExistsBySlug(pool, slug, excludeId = null) {
  let sql = 'SELECT id FROM pages WHERE slug = ?';
  const params = [slug];
  if (excludeId != null) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const [rows] = await pool.query(sql, params);
  return Boolean(rows?.length);
}

function parseParentSelection(raw) {
  const value = trim(raw);
  if (!value || value === '0') {
    return { is_parent: 0, parent_level: 0 };
  }
  if (value === 'no_navigation') {
    return {
      is_parent: NO_NAVIGATION_PARENT,
      parent_level: NO_NAVIGATION_PARENT,
    };
  }

  const parts = value.split('-');
  const parentId = Number(parts[0]);
  const parentLevel = Number(parts[1]);
  if (!Number.isFinite(parentId)) {
    return { is_parent: 0, parent_level: 0 };
  }
  return {
    is_parent: parentId,
    parent_level: Number.isFinite(parentLevel) ? parentLevel + 1 : 0,
  };
}

function validateCreateBody(body) {
  const pageTitle = trim(body.page_title);

  if (!pageTitle) {
    return {
      ok: false,
      message: 'Required fields mark with * can not be left blank',
    };
  }

  const bannerType = Number(body.banner_type ?? 0);
  // Banner/overlay UI retired — no caption/file required for create

  // Retired UI fields — accept if sent, otherwise derive defaults
  const linkTitle = trim(body.link_title) || pageTitle;
  const pageContent = trim(body.page_content);
  let slug = trim(body.slug);
  if (!slug) {
    slug = seoUrl(pageTitle);
  }

  const parent = parseParentSelection(body.is_parent || '0');
  const weightRaw = trim(body.weight);
  const weight = weightRaw === '' ? 0 : Number(weightRaw);

  return {
    ok: true,
    data: {
      page_title: pageTitle,
      page_content: pageContent,
      link_title: linkTitle,
      slug,
      internal_css: trim(body.internal_css),
      meta_title: trim(body.meta_title),
      meta_keyword: trim(body.meta_keyword),
      meta_desc: trim(body.meta_desc),
      page_ex_rhs: trim(body.page_ex_rhs),
      banner_type: bannerType,
      overlay_caption: String(body.overlay_caption) === '1' ? 1 : 0,
      overlay_caption_text:
        bannerType > 0 && String(body.overlay_caption) === '1'
          ? trim(body.overlay_caption_text)
          : '',
      carousel_static_caption: trim(body.carousel_static_caption),
      weight: Number.isFinite(weight) ? weight : 0,
      featured_service: String(body.featured_service) === '1' ? 1 : 0,
      footer_link: String(body.footer_link) === '1' ? 1 : 0,
      featured_icon: trim(body.featured_icon) || 'fa-certificate',
      testimonial_display: String(body.testimonial_display) === '1' ? 1 : 0,
      featured_display: String(body.featured_display) === '1' ? 1 : 0,
      accreditation_display:
        String(body.accreditation_display) === '1' ? 1 : 0,
      display_counter: String(body.display_counter) === '1' ? 1 : 0,
      ...parent,
    },
  };
}

async function createPage(pool, body, file) {
  const validation = validateCreateBody(body);
  if (!validation.ok) {
    return validation;
  }

  const data = validation.data;
  const slugTaken = await pageExistsBySlug(pool, data.slug);
  if (slugTaken) {
    return {
      ok: false,
      message: 'Page already exits with same page name',
    };
  }

  let carouselStaticImage = '';
  if (Number(data.banner_type) === 1) {
    if (!file) {
      return {
        ok: false,
        message: 'Required fields mark with * can not be left blank',
      };
    }
    const upload = saveUploadedBanner(file);
    if (!upload.ok) {
      return upload;
    }
    carouselStaticImage = upload.filename;
  }

  const [result] = await pool.query(
    `INSERT INTO pages (
      is_parent, page_title, page_content, internal_css, meta_title, meta_keyword, meta_desc,
      parent_level, slug, link_title, banner_type, overlay_caption, overlay_caption_text,
      carousel_static_image, carousel_static_caption, page_ex_rhs, weight, featured_service,
      footer_link, featured_icon, testimonial_display, featured_display, accreditation_display,
      display_counter
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.is_parent,
      data.page_title,
      data.page_content,
      data.internal_css,
      data.meta_title,
      data.meta_keyword,
      data.meta_desc,
      data.parent_level,
      data.slug,
      data.link_title,
      data.banner_type,
      data.overlay_caption,
      data.overlay_caption_text,
      carouselStaticImage,
      data.carousel_static_caption,
      data.page_ex_rhs,
      data.weight,
      data.featured_service,
      data.footer_link,
      data.featured_icon,
      data.testimonial_display,
      data.featured_display,
      data.accreditation_display,
      data.display_counter,
    ]
  );

  return {
    ok: true,
    message: 'Page added successfully',
    data: { id: result.insertId },
  };
}

async function updatePageWeight(pool, id, weight) {
  const page = await pageExistsById(pool, id);
  if (!page) {
    return { ok: false, message: 'Page not found to update' };
  }

  const weightNum = weight === '' || weight == null ? 0 : Number(weight);
  const [result] = await pool.query('UPDATE pages SET weight = ? WHERE id = ?', [
    Number.isFinite(weightNum) ? weightNum : 0,
    id,
  ]);

  // Legacy ajaxFile poschange echoes 1 only when affectedRows > 0
  if (!result.affectedRows) {
    return { ok: false, message: 'Error in change position' };
  }

  return { ok: true, message: 'Page position changed successfully' };
}

async function deletePage(pool, id) {
  const page = await pageExistsById(pool, id);
  if (!page) {
    return { ok: false, message: 'Page not found to delete' };
  }

  if (PROTECTED_DELETE_IDS.has(Number(id))) {
    return { ok: false, message: 'Error in deleting page' };
  }

  // Legacy pages.php: DELETE parent row, then cascade children when parent_level < 2
  const [result] = await pool.query('DELETE FROM pages WHERE id = ?', [id]);
  if (!result.affectedRows) {
    return { ok: false, message: 'Error in deleting page' };
  }

  if (Number(page.parent_level) < 2) {
    const [children] = await pool.query(
      'SELECT id, parent_level FROM pages WHERE is_parent = ?',
      [id]
    );
    for (const child of children || []) {
      await pool.query('DELETE FROM pages WHERE id = ?', [child.id]);
      if (Number(child.parent_level) === 1) {
        await pool.query('DELETE FROM pages WHERE is_parent = ?', [child.id]);
      }
    }
  }

  return { ok: true, message: 'Page deleted successfully' };
}

function canDeletePage(page) {
  if (!page) return false;
  if (PROTECTED_DELETE_IDS.has(Number(page.id))) return false;
  if (Number(page.child_count) > 0) return false;
  return true;
}

module.exports = {
  HOME_PAGE_ID,
  listPages,
  getParentPageOptions,
  createPage,
  updatePageWeight,
  deletePage,
  canDeletePage,
  pageExistsById,
  seoUrl,
};
