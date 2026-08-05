const { createTableHandler, selectOne, selectAll, syncChildren } = require('../baseHandler');

const pageBanner = createTableHandler({
  table: 'pages_banner',
  defaults: {
    bg_title: 'Banner',
    bg_image: '',
    bg_color: '#ff0000',
    title_color: '0',
    button_title: '',
    button_link: '',
    container_full_width: '0',
    banner_position: 1,
  },
});

const ourExceptional = createTableHandler({
  table: 'our_exceptional',
  defaults: {
    exceptional_title: '',
    exceptional_subtitle: '',
    button_title: '',
    button_link: '',
    exceptional_content: '',
    exp_image: '',
    instance_number: 0,
    why_footer_content: '',
  },
});

const cbtAcrossLondon = createTableHandler({
  table: 'cbt_across_london',
  defaults: {
    title: '',
    subtitle: '',
    description: '',
    marker_text: '',
    marker_link: '',
    cbt_image: '',
    bg_color: 0,
  },
});

const cbtTestLondon = createTableHandler({
  table: 'cbt_test_london',
  defaults: {
    title: '',
    subtitle: '',
    description: '',
    marker_text: '',
    marker_link: '',
    cbt_image: '',
    bg_color: 0,
    title_top_center: 0,
  },
});

const directAccess = createTableHandler({
  table: 'direct_access',
  defaults: {
    section_title: '',
    section_subtitle: '',
    content: '',
  },
  children: {
    key: 'images',
    table: 'direct_access_image',
    fk: 'direct_access_id',
    columns: ['img_title', 'access_img'],
    defaults: { img_title: '', access_img: '' },
  },
});

const ourServices = createTableHandler({
  table: 'our_services',
  defaults: { service_title: '' },
  children: {
    key: 'images',
    table: 'service_images',
    fk: 'service_id',
    columns: ['service_img', 'img_title', 'img_caption', 'service_url'],
    defaults: { service_img: '', img_title: '', img_caption: '', service_url: '' },
  },
});

const expertTraining = createTableHandler({
  table: 'expert_training_slider',
  defaults: { slider_title: '', slider_subtitle: '' },
  children: {
    key: 'images',
    table: 'expert_training_slider_images',
    fk: 'expert_training_slider_id',
    columns: ['slider_img', 'slider_title', 'img_link', 'img_caption'],
    defaults: { slider_img: '', slider_title: '', img_link: '', img_caption: '' },
  },
});

const why1stop = createTableHandler({
  table: 'why_1stop',
  defaults: {
    why_title: '',
    why_subtitle: '',
    why_content: '',
    why_footer_content: '',
  },
  children: {
    key: 'images',
    table: 'why_1stop_images',
    fk: 'why_id',
    columns: ['icon_title', 'icon_link_title', 'icon_link', 'icon_img', 'icon_content'],
    defaults: {
      icon_title: '',
      icon_link_title: '',
      icon_link: '',
      icon_img: '',
      icon_content: '',
    },
  },
});

const infoCard = createTableHandler({
  table: 'info_card_section',
  pageTypeColumn: null,
  defaults: { bg_color: 'gray', sort_order: 0 },
  children: {
    key: 'cards',
    table: 'info_card_data',
    fk: 'attached_to_card',
    orderBy: 'sort_order',
    orderColumn: 'sort_order',
    columns: ['card_title', 'card_text', 'card_icon'],
    defaults: { card_title: '', card_text: '', card_icon: '' },
  },
});

const priceCard = createTableHandler({
  table: 'price_card_sections',
  pageTypeColumn: null,
  defaults: { title: '', note: '', bottom_text: '', sort_order: 0 },
  children: {
    key: 'cards',
    table: 'price_card_data',
    fk: 'attached_price_card',
    orderBy: 'sort_order',
    orderColumn: 'sort_order',
    columns: [
      'marker_text',
      'title',
      'package_time',
      'price',
      'package_content',
      'note_text',
      'button_text',
      'button_url',
    ],
    defaults: {
      marker_text: '',
      title: '',
      package_time: '',
      price: '',
      package_content: '',
      note_text: '',
      button_text: '',
      button_url: '',
    },
  },
});

const serviceAreas = createTableHandler({
  table: 'service_areas_section',
  pageTypeColumn: null,
  defaults: { border: 0, bullet_type: 'location', show_bg: 0, sort_order: 0 },
  children: {
    key: 'areas',
    table: 'service_areas_data',
    fk: 'attached_to_service',
    orderBy: 'sort_order',
    orderColumn: 'sort_order',
    columns: ['left_text', 'right_text'],
    defaults: { left_text: '', right_text: '' },
  },
});

const accordion = createTableHandler({
  table: 'accordion_section',
  pageTypeColumn: null,
  defaults: { header_txt: '', sort_order: 0 },
  children: {
    key: 'items',
    table: 'accordion_sec_data',
    fk: 'ref_accordion',
    orderBy: 'sort_order',
    orderColumn: 'sort_order',
    columns: ['accordion_title', 'accordion_text'],
    defaults: { accordion_title: '', accordion_text: '' },
  },
});

const contentCards = createTableHandler({
  table: 'content_cards_section',
  pageTypeColumn: null,
  defaults: { content_text: '', sort_order: 0 },
  children: {
    key: 'items',
    table: 'content_cards_items',
    fk: 'ref_content_card',
    orderBy: 'sort_order',
    orderColumn: 'sort_order',
    columns: [
      'item_img_uri',
      'item_title',
      'item_text',
      'red_btn_txt',
      'red_btn_url',
      'blue_btn_txt',
      'blue_btn_url',
      'marker_text',
    ],
    defaults: {
      item_img_uri: '',
      item_title: '',
      item_text: '',
      red_btn_txt: '',
      red_btn_url: '',
      blue_btn_txt: '',
      blue_btn_url: '',
      marker_text: '',
    },
  },
});

const processSteps = createTableHandler({
  table: 'process_steps',
  pageTypeColumn: null,
  defaults: { process_step_title: '', sort_order: 0 },
  children: {
    key: 'steps',
    table: 'process_step_content',
    fk: 'main_process_ref',
    orderBy: 'sort_order',
    orderColumn: 'sort_order',
    columns: ['step_no', 'step_title', 'step_description'],
    defaults: { step_no: '', step_title: '', step_description: '' },
  },
});

const dynamicContent = createTableHandler({
  table: 'dynamic_content_sections',
  defaults: {
    section_title: '',
    instance_number: 0,
    make_cta: '0',
    sort_order: 0,
  },
  children: {
    key: 'items',
    table: 'dynamic_content_items',
    fk: 'section_id',
    orderBy: 'sort_order',
    orderColumn: 'sort_order',
    columns: ['item_type', 'item_title', 'item_content', 'item_url', 'item_image'],
    defaults: {
      item_type: 'text',
      item_title: '',
      item_content: '',
      item_url: '',
      item_image: '',
    },
  },
});

const directionsParking = {
  async load(pool, contentId) {
    const section = await selectOne(pool, 'SELECT * FROM tab_section WHERE id = ? LIMIT 1', [
      contentId,
    ]);
    if (!section) return null;
    const tabs = await selectAll(
      pool,
      'SELECT * FROM tabs WHERE attached_to_tab = ? ORDER BY tabs_order ASC, id ASC',
      [contentId]
    );
    return { ...section, tabs };
  },

  async createEmpty(pool, pageId) {
    const [result] = await pool.query(
      `INSERT INTO tab_section (title, image_uri, page_type, page_id) VALUES (?, ?, 'page', ?)`,
      ['Directions & Parking', '', pageId]
    );
    return result.insertId;
  },

  async save(pool, contentId, payload = {}) {
    await pool.query(
      'UPDATE tab_section SET title = ?, image_uri = ? WHERE id = ?',
      [payload.title || '', payload.image_uri || '', contentId]
    );
    if (Array.isArray(payload.tabs)) {
      await syncChildren(pool, contentId, payload.tabs, {
        table: 'tabs',
        fk: 'attached_to_tab',
        orderColumn: 'tabs_order',
        columns: ['tab_name', 'tab_text', 'tab_icon_url'],
        defaults: { tab_name: '', tab_text: '', tab_icon_url: '' },
      });
    }
    return { ok: true };
  },

  async remove(pool, contentId) {
    await pool.query('DELETE FROM tabs WHERE attached_to_tab = ?', [contentId]);
    await pool.query('DELETE FROM tab_section WHERE id = ?', [contentId]);
    return { ok: true };
  },

  async removeItem(pool, contentId, itemId) {
    await pool.query('DELETE FROM tabs WHERE id = ? AND attached_to_tab = ?', [
      itemId,
      contentId,
    ]);
    return { ok: true };
  },
};

const homeSlider = {
  async load(pool, contentId) {
    const slider = await selectOne(pool, 'SELECT * FROM pageSliders WHERE id = ? LIMIT 1', [
      contentId,
    ]);
    if (!slider) return null;
    const images = await selectAll(
      pool,
      'SELECT * FROM pageSliderImg WHERE pageSliders_id = ? ORDER BY id ASC',
      [contentId]
    );
    const box = await selectOne(
      pool,
      'SELECT * FROM sliderBoxData WHERE pageSliders_id = ? LIMIT 1',
      [contentId]
    );
    return { ...slider, images, box: box || null };
  },

  async createEmpty(pool, pageId) {
    const [result] = await pool.query(
      `INSERT INTO pageSliders (page_id, page_type, title, next_available_text, page_course_id)
       VALUES (?, 'page', '', '', NULL)`,
      [pageId]
    );
    const sliderId = result.insertId;
    await pool.query(
      `INSERT INTO sliderBoxData (
        pageSliders_id, title, subtitle, promocode,
        book_online_button_title, book_online_button_link,
        find_cbt_button_title, find_cbt_button_link
      ) VALUES (?, '', '', '', '', '', '', '')`,
      [sliderId]
    );
    return sliderId;
  },

  async save(pool, contentId, payload = {}) {
    await pool.query(
      `UPDATE pageSliders SET title = ?, next_available_text = ?, page_course_id = ? WHERE id = ?`,
      [
        payload.title || '',
        payload.next_available_text || '',
        payload.page_course_id || null,
        contentId,
      ]
    );

    if (payload.box) {
      const box = payload.box;
      const existing = await selectOne(
        pool,
        'SELECT id FROM sliderBoxData WHERE pageSliders_id = ? LIMIT 1',
        [contentId]
      );
      if (existing) {
        await pool.query(
          `UPDATE sliderBoxData SET
            title = ?, subtitle = ?, promocode = ?,
            book_online_button_title = ?, book_online_button_link = ?,
            find_cbt_button_title = ?, find_cbt_button_link = ?
           WHERE pageSliders_id = ?`,
          [
            box.title || '',
            box.subtitle || '',
            box.promocode || '',
            box.book_online_button_title || '',
            box.book_online_button_link || '',
            box.find_cbt_button_title || '',
            box.find_cbt_button_link || '',
            contentId,
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO sliderBoxData (
            pageSliders_id, title, subtitle, promocode,
            book_online_button_title, book_online_button_link,
            find_cbt_button_title, find_cbt_button_link
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            contentId,
            box.title || '',
            box.subtitle || '',
            box.promocode || '',
            box.book_online_button_title || '',
            box.book_online_button_link || '',
            box.find_cbt_button_title || '',
            box.find_cbt_button_link || '',
          ]
        );
      }
    }

    if (Array.isArray(payload.images)) {
      await syncChildren(pool, contentId, payload.images, {
        table: 'pageSliderImg',
        fk: 'pageSliders_id',
        columns: ['alt_title', 'image_caption', 'slider_image'],
        defaults: { alt_title: '', image_caption: '', slider_image: '' },
      });
    }

    return { ok: true };
  },

  async remove(pool, contentId) {
    await pool.query('DELETE FROM pageSliderImg WHERE pageSliders_id = ?', [contentId]);
    await pool.query('DELETE FROM sliderBoxData WHERE pageSliders_id = ?', [contentId]);
    await pool.query('DELETE FROM pageSliders WHERE id = ?', [contentId]);
    return { ok: true };
  },

  async removeItem(pool, contentId, itemId) {
    await pool.query('DELETE FROM pageSliderImg WHERE id = ? AND pageSliders_id = ?', [
      itemId,
      contentId,
    ]);
    return { ok: true };
  },
};

const cmsSidebar = {
  async load(pool, contentId) {
    // content_id points at one sidebar row; load all for page
    const row = await selectOne(pool, 'SELECT * FROM cms_sidebar WHERE id = ? LIMIT 1', [
      contentId,
    ]);
    if (!row) return null;
    const items = await selectAll(
      pool,
      'SELECT * FROM cms_sidebar WHERE page_id = ? ORDER BY sort_order ASC, id ASC',
      [row.page_id]
    );
    return { page_id: row.page_id, items };
  },

  async createEmpty(pool, pageId) {
    const [result] = await pool.query(
      `INSERT INTO cms_sidebar (sidebar_item_title, sidebar_item_text, sort_order, page_id)
       VALUES ('', '', 1, ?)`,
      [pageId]
    );
    return result.insertId;
  },

  async save(pool, contentId, payload = {}) {
    const row = await selectOne(pool, 'SELECT page_id FROM cms_sidebar WHERE id = ? LIMIT 1', [
      contentId,
    ]);
    if (!row) return { ok: false, message: 'Sidebar not found' };
    if (!Array.isArray(payload.items)) {
      return { ok: true, contentId };
    }
    const pageId = row.page_id;
    await pool.query('DELETE FROM cms_sidebar WHERE page_id = ?', [pageId]);
    const items = payload.items;
    let firstId = null;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i] || {};
      const [result] = await pool.query(
        `INSERT INTO cms_sidebar (sidebar_item_title, sidebar_item_text, sort_order, page_id)
         VALUES (?, ?, ?, ?)`,
        [
          item.sidebar_item_title || '',
          item.sidebar_item_text || '',
          i + 1,
          pageId,
        ]
      );
      if (firstId == null) firstId = result.insertId;
    }
    if (firstId == null) {
      const [result] = await pool.query(
        `INSERT INTO cms_sidebar (sidebar_item_title, sidebar_item_text, sort_order, page_id)
         VALUES ('', '', 1, ?)`,
        [pageId]
      );
      firstId = result.insertId;
    }
    return { ok: true, contentId: firstId };
  },

  async remove(pool, contentId) {
    const row = await selectOne(pool, 'SELECT page_id FROM cms_sidebar WHERE id = ? LIMIT 1', [
      contentId,
    ]);
    if (row) {
      await pool.query('DELETE FROM cms_sidebar WHERE page_id = ?', [row.page_id]);
    }
    return { ok: true };
  },

  async removeItem() {
    return { ok: true };
  },
};

module.exports = {
  home_slider: homeSlider,
  direct_access: directAccess,
  our_services: ourServices,
  cheap_cbt_test_across_london: cbtAcrossLondon,
  cheap_cbt_test_london: cbtTestLondon,
  expert_training: expertTraining,
  why_1stop: why1stop,
  our_exceptional: ourExceptional,
  page_banner: pageBanner,
  dynamic_content: dynamicContent,
  directions_parking: directionsParking,
  info_card: infoCard,
  price_card: priceCard,
  service_areas: serviceAreas,
  accordion,
  content_cards: contentCards,
  process_steps: processSteps,
  cms_sidebar: cmsSidebar,
};
