const { getParentPageOptions, getSectionCatalog } = require('../pagesService');

/** Legacy add_page.php empty form defaults. */
async function loadNewPageEditor(pool) {
  const [parentOptions, sectionCatalog] = await Promise.all([
    getParentPageOptions(pool),
    getSectionCatalog(pool),
  ]);

  return {
    page: {
      page_title: '',
      link_title: '',
      page_content: '',
      slug: '',
      is_parent_selection: '0',
      weight: '0',
      banner_type: 0,
      overlay_caption: 0,
      overlay_caption_text: '',
      carousel_static_image: '',
      carousel_static_caption: '',
      page_ex_rhs: '',
      internal_css: '',
      meta_title: '',
      meta_keyword: '',
      meta_desc: '',
      schema_script: '',
      featured_icon: '',
      featured_service: 0,
      footer_link: 0,
      testimonial_display: 0,
      featured_display: 0,
      accreditation_display: 0,
      display_counter: 0,
      status: 1,
    },
    parentOptions,
    sectionCatalog,
    enabledSectionSlugs: [],
    sections: [],
  };
}

module.exports = { loadNewPageEditor };
