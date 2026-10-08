const {
  getPageById,
  getParentPageOptions,
  getSectionCatalog,
  getCmsPublicPathForPageId,
  NAV_NOT_REQUIRED_SENTINEL,
} = require('../pagesService');

async function junctionSortRows(pool, pageId, dataType = 'page') {
  const [rows] = await pool.query(
    `SELECT id, section_data, section_id, sort_order
     FROM page_junction
     WHERE data_id = ? AND data_type = ?
     ORDER BY sort_order ASC, id ASC`,
    [pageId, dataType]
  );
  return rows || [];
}

async function loadHomeSlider(pool, pageId, dataType = 'page') {
  const [rows] = await pool.query(
    `SELECT
      ps.id AS slider_id,
      ps.page_id,
      ps.title,
      ps.next_available_text,
      ps.page_course_id,
      psi.id AS image_id,
      psi.alt_title,
      psi.image_caption,
      psi.slider_image,
      sbd.id AS box_id,
      sbd.title AS box_title,
      sbd.subtitle,
      sbd.book_online_button_title,
      sbd.book_online_button_link,
      sbd.find_cbt_button_title,
      sbd.find_cbt_button_link,
      sbd.promocode
     FROM pageSliders ps
     LEFT JOIN pageSliderImg psi ON psi.pageSliders_id = ps.id
     LEFT JOIN sliderBoxData sbd ON sbd.pageSliders_id = ps.id
     WHERE ps.page_type = ? AND ps.page_id = ?`,
    [dataType, pageId]
  );

  if (!rows.length) return null;

  const main = {
    slider_id: rows[0].slider_id,
    page_id: rows[0].page_id,
    title: rows[0].title,
    next_available_text: rows[0].next_available_text,
    page_course_id: rows[0].page_course_id,
  };
  const sliderBoxData = rows[0].box_id
    ? {
        box_id: rows[0].box_id,
        title: rows[0].box_title,
        subtitle: rows[0].subtitle,
        book_online_button_title: rows[0].book_online_button_title,
        book_online_button_link: rows[0].book_online_button_link,
        find_cbt_button_title: rows[0].find_cbt_button_title,
        find_cbt_button_link: rows[0].find_cbt_button_link,
        promocode: rows[0].promocode,
      }
    : null;

  const images = [];
  const seen = new Set();
  for (const row of rows) {
    if (row.image_id && !seen.has(row.image_id)) {
      seen.add(row.image_id);
      images.push({
        image_id: row.image_id,
        alt_title: row.alt_title,
        image_caption: row.image_caption,
        slider_image: row.slider_image,
      });
    }
  }

  return { pageSliders: main, sliderBoxData, direct_access_images_slider: images };
}

async function loadDirectAccessInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM direct_access WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [images] = await pool.query(
    `SELECT * FROM direct_access_image WHERE direct_access_id = ? ORDER BY id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    section_title: section.section_title,
    content: section.content,
    images: images || [],
  };
}

async function loadOurServicesInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM our_services WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [images] = await pool.query(
    `SELECT * FROM service_images WHERE service_id = ? ORDER BY id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    service_title: section.service_title,
    service_images: images || [],
  };
}

async function loadCbtAcrossLondonInstance(pool, pageId, sectionId) {
  const [rows] = await pool.query(
    `SELECT * FROM cbt_across_london WHERE id = ? AND page_id = ? LIMIT 1`,
    [sectionId, pageId]
  );
  return rows?.[0] || null;
}

async function loadCbtTestLondonInstance(pool, pageId, sectionId) {
  const [rows] = await pool.query(
    `SELECT * FROM cbt_test_london WHERE id = ? AND page_id = ? LIMIT 1`,
    [sectionId, pageId]
  );
  return rows?.[0] || null;
}

async function loadCmsSidebar(pool, pageId) {
  const [items] = await pool.query(
    `SELECT * FROM cms_sidebar WHERE page_id = ? ORDER BY sort_order ASC`,
    [pageId]
  );
  return { cms_sidebar_items: items || [] };
}

async function loadExpertTrainingInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM expert_training_slider WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [images] = await pool.query(
    `SELECT * FROM expert_training_slider_images WHERE expert_training_slider_id = ? ORDER BY id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    slider_title: section.slider_title,
    slider_subtitle: section.slider_subtitle,
    exp_service_images: images || [],
  };
}

async function loadWhy1stopInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM why_1stop WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [images] = await pool.query(
    `SELECT * FROM why_1stop_images WHERE why_id = ? ORDER BY id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    why_title: section.why_title,
    why_subtitle: section.why_subtitle,
    why_content: section.why_content,
    why_footer_content: section.why_footer_content,
    why_images: images || [],
  };
}

async function loadDirectionsParkingInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM tab_section WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [tabs] = await pool.query(
    `SELECT * FROM tabs WHERE attached_to_tab = ? ORDER BY tabs_order ASC, id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    title: section.title,
    image_uri: section.image_uri,
    tabs: tabs || [],
  };
}

async function loadPageBannerInstance(pool, sectionId) {
  const [rows] = await pool.query(`SELECT * FROM pages_banner WHERE id = ? LIMIT 1`, [
    sectionId,
  ]);
  return rows?.[0] || null;
}

async function loadOurExceptionalInstance(pool, sectionId) {
  const [rows] = await pool.query(`SELECT * FROM our_exceptional WHERE id = ? LIMIT 1`, [
    sectionId,
  ]);
  return rows?.[0] || null;
}

async function loadDynamicContentInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM dynamic_content_sections WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [items] = await pool.query(
    `SELECT * FROM dynamic_content_items WHERE section_id = ? ORDER BY sort_order ASC, id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    title: section.section_title,
    make_cta: section.make_cta,
    items: items || [],
  };
}

async function loadInfoCardInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM info_card_section WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [cards] = await pool.query(
    `SELECT * FROM info_card_data WHERE attached_to_card = ? ORDER BY sort_order ASC, id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    bg_color: section.bg_color,
    cards: cards || [],
  };
}

async function loadPriceCardInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM price_card_sections WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [cards] = await pool.query(
    `SELECT * FROM price_card_data WHERE attached_price_card = ? ORDER BY sort_order ASC, id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    title: section.title,
    note: section.note,
    bottom_text: section.bottom_text,
    cards: cards || [],
  };
}

async function loadAccordionInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM accordion_section WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [items] = await pool.query(
    `SELECT * FROM accordion_sec_data WHERE ref_accordion = ? ORDER BY sort_order ASC, id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    header_txt: section.header_txt,
    sort_order: section.sort_order,
    items: items || [],
  };
}

async function loadContentCardsInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM content_cards_section WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [items] = await pool.query(
    `SELECT * FROM content_cards_items WHERE ref_content_card = ? ORDER BY sort_order ASC, id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    content_text: section.content_text,
    items: items || [],
  };
}

async function loadProcessStepsInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM process_steps WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [items] = await pool.query(
    `SELECT * FROM process_step_content WHERE main_process_ref = ? ORDER BY sort_order ASC, id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    process_step_title: section.process_step_title,
    sort_order: section.sort_order,
    items: items || [],
  };
}

async function loadServiceAreasInstance(pool, sectionId) {
  const [sectionRows] = await pool.query(
    `SELECT * FROM service_areas_section WHERE id = ? LIMIT 1`,
    [sectionId]
  );
  const section = sectionRows?.[0];
  if (!section) return null;

  const [data] = await pool.query(
    `SELECT * FROM service_areas_data WHERE attached_to_service = ? ORDER BY sort_order ASC, id ASC`,
    [sectionId]
  );

  return {
    section_id: section.id,
    border: section.border,
    show_bg: section.show_bg,
    bullet_type: section.bullet_type,
    data: data || [],
  };
}

async function loadSectionPayload(pool, pageId, slug, sectionId, dataType = 'page') {
  switch (slug) {
    case 'home_slider':
      return loadHomeSlider(pool, pageId, dataType);
    case 'direct_access':
      return loadDirectAccessInstance(pool, sectionId);
    case 'our_services':
      return loadOurServicesInstance(pool, sectionId);
    case 'cheap_cbt_test_across_london':
      return loadCbtAcrossLondonInstance(pool, pageId, sectionId);
    case 'cheap_cbt_test_london':
      return loadCbtTestLondonInstance(pool, pageId, sectionId);
    case 'cms_sidebar':
      return loadCmsSidebar(pool, pageId);
    case 'expert_training':
      return loadExpertTrainingInstance(pool, sectionId);
    case 'why_1stop':
      return loadWhy1stopInstance(pool, sectionId);
    case 'directions_parking':
      return loadDirectionsParkingInstance(pool, sectionId);
    case 'page_banner':
      return loadPageBannerInstance(pool, sectionId);
    case 'our_exceptional':
      return loadOurExceptionalInstance(pool, sectionId);
    case 'dynamic_content':
      return loadDynamicContentInstance(pool, sectionId);
    case 'info_card':
      return loadInfoCardInstance(pool, sectionId);
    case 'price_card':
      return loadPriceCardInstance(pool, sectionId);
    case 'accordion':
      return loadAccordionInstance(pool, sectionId);
    case 'content_cards':
      return loadContentCardsInstance(pool, sectionId);
    case 'process_steps':
      return loadProcessStepsInstance(pool, sectionId);
    case 'service_areas':
      return loadServiceAreasInstance(pool, sectionId);
    default:
      return null;
  }
}

function formatPageForEditor(row) {
  if (!row) return null;
  const page = { ...row };
  if (
    Number(page.is_parent) === NAV_NOT_REQUIRED_SENTINEL &&
    Number(page.parent_level) === NAV_NOT_REQUIRED_SENTINEL
  ) {
    page.is_parent_selection = 'no_navigation';
  } else if (Number(page.is_parent) > 0) {
    page.is_parent_selection = `${page.is_parent}-${Number(page.parent_level) - 1}`;
  } else {
    page.is_parent_selection = '0';
  }
  return page;
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} pageId
 */
async function loadPageEditor(pool, pageId, options = {}) {
  const id = Number(pageId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('loadPageEditor requires valid pageId');
  }

  const dataType = options.dataType || 'page';
  const pageRow =
    options.pageRow != null ? options.pageRow : await getPageById(pool, id);
  if (!pageRow) {
    return null;
  }

  const loadExtras = options.loadExtras !== false;
  const [parentOptions, sectionCatalog, junctionRows, cmsPath] = await Promise.all([
    loadExtras ? getParentPageOptions(pool) : Promise.resolve([]),
    getSectionCatalog(pool),
    junctionSortRows(pool, id, dataType),
    loadExtras && dataType === 'page'
      ? getCmsPublicPathForPageId(pool, id)
      : Promise.resolve(options.cmsPath ?? pageRow.slug ?? ''),
  ]);

  const enabledSectionSlugs = [
    ...new Set(junctionRows.map((r) => r.section_data).filter(Boolean)),
  ];

  const sections = [];
  const loadedSingletons = new Set();

  for (const junction of junctionRows) {
    const slug = junction.section_data;
    const sectionId = junction.section_id;

    if (slug === 'home_slider' || slug === 'cms_sidebar') {
      if (loadedSingletons.has(slug)) continue;
      loadedSingletons.add(slug);
    }

    const data = await loadSectionPayload(pool, id, slug, sectionId, dataType);
    if (data == null) continue;

    sections.push({
      slug,
      junctionId: junction.id,
      sectionId: sectionId ?? null,
      sortOrder: junction.sort_order,
      data,
    });
  }

  const page =
    typeof options.formatPage === 'function'
      ? options.formatPage(pageRow)
      : formatPageForEditor(pageRow);
  if (page) {
    page.cms_path = cmsPath;
    page.data_type = dataType;
  }

  return {
    page,
    parentOptions,
    sectionCatalog,
    enabledSectionSlugs,
    sections,
    dataType,
  };
}

module.exports = {
  loadPageEditor,
  loadSectionPayload,
};
