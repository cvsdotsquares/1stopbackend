const fs = require('fs');
const path = require('path');
const {
  trim,
  flag,
  createFileAccessor,
  getFrontUploadDir,
  saveUniqTrueUpload,
} = require('./helpers');
const {
  seoUrl,
  slugExists,
  parseParentSelection,
  parseBannerOverlay,
  parsePageStatusFromBody,
  PAGE_STATUS_PUBLISHED,
  ADMIN_PAGE_HOME_ID,
  NAV_NOT_REQUIRED_SENTINEL,
} = require('../pagesService');
const { validatePageRequiredFields } = require('../pageFormValidation');
const { normalizeStoredPageSlug } = require('../../../utils/cmsPageResolver');

const CAROUSEL_SKIP_FILE_MARKERS = [
  'direct_access_images',
  'service_images',
  'cbt_image',
  'service_cbt_image',
  'exp_service_images',
  'why_images',
  'exp_image',
  'banner',
  'direct_access_images_slider',
];

function resolveParent(body, pageId) {
  let { is_parent, parent_level } = parseParentSelection(body.is_parent);
  const id = Number(pageId);
  if (id === is_parent) {
    is_parent = 0;
    parent_level = 0;
  }
  return { is_parent, parent_level };
}

async function handleCarouselStaticImage(existingFilename, body, files) {
  let carousel_static_image = existingFilename || '';
  const fileAccess = createFileAccessor(files);

  if (files?.length && fileAccess.hasAnyFieldMatching(CAROUSEL_SKIP_FILE_MARKERS)) {
    return carousel_static_image;
  }

  const carouselFile =
    fileAccess.getFile('carousel_static_image') ||
    fileAccess.getFile(['carousel_static_image']);

  if (!carouselFile?.buffer?.length) {
    return carousel_static_image;
  }

  const uploadDir = getFrontUploadDir('');
  const uploaded = saveUniqTrueUpload(carouselFile, uploadDir, 'carousel_');
  if (!uploaded) {
    return carousel_static_image;
  }

  if (
    carousel_static_image &&
    carousel_static_image !== uploaded
  ) {
    const oldPath = path.join(uploadDir, carousel_static_image);
    try {
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch {
      /* ignore unlink errors */
    }
  }

  return uploaded;
}

/**
 * Port of edit_page.php pages UPDATE (lines 38–103).
 * @returns {{ ok: boolean, message?: string }}
 */
async function savePageCore(pool, pageId, body, files) {
  const id = Number(pageId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: 'Page not found to edit' };
  }

  const requiredCheck = validatePageRequiredFields(body);
  if (!requiredCheck.ok) {
    return {
      ok: false,
      message: requiredCheck.message,
      missingFields: requiredCheck.missingFields,
    };
  }

  const [pageRows] = await pool.query('SELECT * FROM pages WHERE id = ? LIMIT 1', [
    id,
  ]);
  const existing = pageRows?.[0];
  if (!existing) {
    return { ok: false, message: 'Page not found to edit' };
  }

  let slug = normalizeStoredPageSlug(body.slug) || seoUrl(body.page_title);

  if (await slugExists(pool, slug, id)) {
    return { ok: false, message: 'Another page already exits with same page name' };
  }

  const { is_parent, parent_level } = resolveParent(body, id);
  const overlay = parseBannerOverlay(body);

  const carousel_static_image = await handleCarouselStaticImage(
    existing.carousel_static_image,
    body,
    files
  );

  const featured_service = flag(body, 'featured_service');
  const footer_link = flag(body, 'footer_link');
  const testimonial_display = flag(body, 'testimonial_display');
  const featured_display = flag(body, 'featured_display');
  const accreditation_display = flag(body, 'accreditation_display');
  const display_counter = flag(body, 'display_counter');
  let status;
  if (body.status === undefined || body.status === null) {
    status = Number(existing.status) === 0 ? 0 : PAGE_STATUS_PUBLISHED;
  } else {
    status = parsePageStatusFromBody(body);
  }
  if (id === ADMIN_PAGE_HOME_ID) {
    status = PAGE_STATUS_PUBLISHED;
  }

  const [result] = await pool.query(
    `UPDATE pages SET
      is_parent = ?, page_title = ?, page_content = ?, meta_title = ?, meta_keyword = ?,
      meta_desc = ?, parent_level = ?, slug = ?, link_title = ?, banner_type = ?,
      carousel_static_image = ?, carousel_static_caption = ?, weight = ?, page_ex_rhs = ?,
      featured_service = ?, footer_link = ?, featured_icon = ?, testimonial_display = ?,
      featured_display = ?, accreditation_display = ?, updated = ?, internal_css = ?,
      overlay_caption = ?, overlay_caption_text = ?, schema_script = ?, display_counter = ?,
      status = ?
     WHERE id = ?`,
    [
      is_parent,
      trim(body.page_title),
      body.page_content ?? '',
      body.meta_title ?? '',
      body.meta_keyword ?? '',
      body.meta_desc ?? '',
      parent_level,
      slug,
      trim(body.link_title),
      Number(body.banner_type) || 0,
      carousel_static_image,
      trim(body.carousel_static_caption),
      trim(body.weight) || 0,
      body.page_ex_rhs ?? '',
      featured_service,
      footer_link,
      trim(body.featured_icon),
      testimonial_display,
      featured_display,
      accreditation_display,
      new Date(),
      body.internal_css ?? '',
      overlay.overlay_caption,
      overlay.overlay_caption_text,
      body.schema_script ?? '',
      display_counter,
      status,
      id,
    ]
  );

  if (!result.affectedRows) {
    return { ok: false, message: 'Error in updating page' };
  }

  return {
    ok: true,
    slug,
    is_parent,
    parent_level,
    navSentinel: NAV_NOT_REQUIRED_SENTINEL,
  };
}

module.exports = {
  savePageCore,
  handleCarouselStaticImage,
  CAROUSEL_SKIP_FILE_MARKERS,
};
