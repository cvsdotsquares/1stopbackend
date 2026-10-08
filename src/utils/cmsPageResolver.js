/**
 * Resolve CMS page lookups for GET /api/cmspages/:path
 * (public site + optional preview mode before a page is in the live menu).
 */

function normalizeCmsPath(rawPath) {
  const trimmed = String(rawPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed;
}

/** Legacy rows may store slugs with a leading slash; match all common forms. */
function slugPathVariants(pathKey) {
  const normalized = normalizeCmsPath(pathKey);
  if (!normalized) {
    return [];
  }
  return [...new Set([normalized, `/${normalized}`])];
}

async function findPageIdBySlugVariants(pool, pathKey) {
  const variants = slugPathVariants(pathKey);
  if (!variants.length) {
    return null;
  }
  const placeholders = variants.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT id FROM pages WHERE slug IN (${placeholders}) ORDER BY id DESC LIMIT 1`,
    variants
  );
  return rows?.[0]?.id != null ? Number(rows[0].id) : null;
}

async function findMenuRowsBySlugVariants(pool, pathKey) {
  const variants = slugPathVariants(pathKey);
  if (!variants.length) {
    return [];
  }
  const placeholders = variants.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `
      SELECT id, page_slug, page_link_id, front_menu_show
      FROM page_menus
      WHERE page_slug IN (${placeholders})
      LIMIT 1
    `,
    variants
  );
  return rows || [];
}

function isCmsPreviewRequest(req) {
  const value = req.query?.preview;
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * Preview is allowed when:
 * - X-CMS-Preview-Key matches CMS_PREVIEW_KEY (user portal SSR), or
 * - CMS_PREVIEW_KEY is unset and NODE_ENV is not production (local dev).
 */
function assertCmsPreviewAuthorized(req, res) {
  const configuredKey = String(process.env.CMS_PREVIEW_KEY || '').trim();

  if (configuredKey) {
    const headerKey = String(req.headers['x-cms-preview-key'] || '').trim();
    if (headerKey && headerKey === configuredKey) {
      return null;
    }
    return res.status(403).json({
      success: false,
      message: 'CMS preview is not authorized',
    });
  }

  // No CMS_PREVIEW_KEY: allow ?preview=1 (typical local/staging). Set CMS_PREVIEW_KEY in
  // production and have the user portal send X-CMS-Preview-Key on SSR fetches.
  return null;
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} fullPath normalized path without leading/trailing slashes
 * @param {{ preview?: boolean }} options
 * @returns {Promise<{ pageId: number | null, pagesMenuRows: Array<{ id: number, page_slug: string, page_link_id: number, front_menu_show?: number }> }>}
 */
async function resolveCmsPageLookup(
  pool,
  fullPath,
  { preview = false, pageIdHint = null } = {}
) {
  const pathKey = normalizeCmsPath(fullPath);

  if (preview && pageIdHint != null && pageIdHint !== '') {
    const hintedId = Number(pageIdHint);
    if (Number.isFinite(hintedId) && hintedId > 0) {
      const [pageRows] = await pool.query(
        'SELECT id FROM pages WHERE id = ? LIMIT 1',
        [hintedId]
      );
      if (pageRows.length > 0) {
        return { pageId: hintedId, pagesMenuRows: [] };
      }
    }
  }

  const menuRows = await findMenuRowsBySlugVariants(pool, pathKey);

  if (menuRows.length > 0 && menuRows[0].page_link_id) {
    return {
      pageId: Number(menuRows[0].page_link_id),
      pagesMenuRows: menuRows,
    };
  }

  if (!preview) {
    return { pageId: null, pagesMenuRows: menuRows };
  }

  if (pathKey === '') {
    const homeId = Number(process.env.CMS_HOME_PAGE_ID || 9);
    if (Number.isFinite(homeId) && homeId > 0) {
      return { pageId: homeId, pagesMenuRows: menuRows };
    }
  }

  const pageIdFromSlug = await findPageIdBySlugVariants(pool, pathKey);
  if (pageIdFromSlug) {
    return {
      pageId: pageIdFromSlug,
      pagesMenuRows: menuRows,
    };
  }

  return { pageId: null, pagesMenuRows: menuRows };
}

/**
 * Public URL path segment(s) the user portal uses in /api/cmspages/:path
 * (page_menus.page_slug when present, otherwise pages.slug).
 */
async function getCmsPublicPathForPageId(pool, pageId) {
  const id = Number(pageId);
  if (!Number.isFinite(id) || id <= 0) return '';

  const [menuRows] = await pool.query(
    `
      SELECT page_slug
      FROM page_menus
      WHERE page_link_id = ?
      ORDER BY id ASC
      LIMIT 1
    `,
    [id]
  );

  if (menuRows.length > 0 && menuRows[0].page_slug != null) {
    return normalizeCmsPath(menuRows[0].page_slug);
  }

  const [pageRows] = await pool.query('SELECT slug FROM pages WHERE id = ? LIMIT 1', [id]);
  if (pageRows.length > 0 && pageRows[0].slug != null) {
    return normalizeCmsPath(pageRows[0].slug);
  }

  return '';
}

async function getCmsPublicPathsByPageIds(pool, pageIds) {
  const ids = [...new Set(pageIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const map = new Map();
  if (!ids.length) return map;

  const placeholders = ids.map(() => '?').join(',');
  const [menuRows] = await pool.query(
    `
      SELECT page_link_id, page_slug
      FROM page_menus
      WHERE page_link_id IN (${placeholders})
      ORDER BY page_link_id ASC, id ASC
    `,
    ids
  );

  for (const row of menuRows || []) {
    const linkId = Number(row.page_link_id);
    if (!map.has(linkId) && row.page_slug != null) {
      map.set(linkId, normalizeCmsPath(row.page_slug));
    }
  }

  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) {
    const missingPlaceholders = missing.map(() => '?').join(',');
    const [pageRows] = await pool.query(
      `SELECT id, slug FROM pages WHERE id IN (${missingPlaceholders})`,
      missing
    );
    for (const row of pageRows || []) {
      map.set(Number(row.id), normalizeCmsPath(row.slug));
    }
  }

  return map;
}

function normalizeStoredPageSlug(rawSlug, fallbackTitle) {
  const trimmed = trimOrEmpty(rawSlug);
  if (trimmed) {
    return normalizeCmsPath(trimmed);
  }
  return '';
}

function trimOrEmpty(value) {
  return value == null ? '' : String(value).trim();
}

module.exports = {
  normalizeCmsPath,
  normalizeStoredPageSlug,
  isCmsPreviewRequest,
  assertCmsPreviewAuthorized,
  resolveCmsPageLookup,
  getCmsPublicPathForPageId,
  getCmsPublicPathsByPageIds,
};
