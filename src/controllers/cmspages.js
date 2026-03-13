const { replaceTokensInObject } = require('../utils/tokenReplacer');

class CMSPagesController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get page by nested slug path (e.g., /hello, /hello/world, /hello/world/say)
   */
  async getPageByNestedSlug(req, res) {
    try {
      const fullPath = req.path.slice(1);

      // Get page by exact slug from menu
      // Get page by slug
      const [pages_menu] = await this.pool.query(`
        SELECT
          id, page_slug, page_link_id
        FROM page_menus
        WHERE page_slug = ?
      `, [fullPath]);


      // Get page by slug
      const [pages] = await this.pool.query(`
        SELECT
          id, page_title, slug , meta_title, meta_keyword, meta_desc,
          is_parent, parent_level, link_title, banner_type, overlay_caption, page_content, overlay_caption_text,
          weight, carousel_static_image, carousel_static_caption, featured_service, featured_icon,
          footer_link, testimonial_display, featured_display, accreditation_display, created, updated
        FROM pages
        WHERE id = ?
      `, [pages_menu.length > 0 ? pages_menu[0].page_link_id : null]);

      if (pages.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Page not found'
        });
      }

      const page = pages[0];

      // Get section ordering from page_junction table
      const [pageJunctions] = await this.pool.query(`
        SELECT section_data, sort_order
        FROM page_junction
        WHERE data_id = ?
        ORDER BY CAST(sort_order AS UNSIGNED) ASC, section_data ASC
      `, [page.id]);

      // Create a map of section types to their sort order
      const sectionOrderMap = {};
      pageJunctions.forEach(junction => {
        sectionOrderMap[junction.section_data] = junction.sort_order;
      });

      const normalizedSectionOrderMap = {};
      pageJunctions.forEach((junction) => {
        const normalizedKey = String(junction.section_data || '').trim().toLowerCase();
        const parsedOrder = Number(junction.sort_order);

        if (!normalizedKey || Number.isNaN(parsedOrder)) {
          return;
        }

        if (!normalizedSectionOrderMap[normalizedKey]) {
          normalizedSectionOrderMap[normalizedKey] = [];
        }

        normalizedSectionOrderMap[normalizedKey].push(parsedOrder);
      });

      const fallbackOrderCounter = {};

      const getNextSectionOrder = (keys, fallback) => {
        const keyList = Array.isArray(keys) ? keys : [keys];

        for (const key of keyList) {
          const normalizedKey = String(key).trim().toLowerCase();
          const orderValues = normalizedSectionOrderMap[normalizedKey];

          if (Array.isArray(orderValues) && orderValues.length > 0) {
            return orderValues.shift();
          }
        }

        const fallbackKey = String(keyList[0] || 'fallback').trim().toLowerCase();
        fallbackOrderCounter[fallbackKey] = (fallbackOrderCounter[fallbackKey] || 0) + 1;

        return fallback + (fallbackOrderCounter[fallbackKey] / 1000);
      };

      // Get dynamic content sections for this page
      const [sections] = await this.pool.query(`
        SELECT *
        FROM dynamic_content_sections
        WHERE page_id = ?
        ORDER BY sort_order ASC
      `, [page.id]);

      // Get dynamic content items for each section
      for (let section of sections) {
        const [items] = await this.pool.query(`
          SELECT *
          FROM dynamic_content_items
          WHERE section_id = ?
          ORDER BY sort_order ASC
        `, [section.id]);

        // Sanitize content to prevent hydration issues
        section.items = items.map(item => ({
          ...item,
          item_content: item.item_content ? item.item_content.trim().replace(/\r\n/g, '\n') : ''
        }));
      }

      // Get additional homepage-style sections for this page
      let aboutData = null;
      let servicesData = null;
      let trainingSliderData = null;
      let whyUsData = null;
      let cbtLondonData = null;
      let cbtTestLondonData = null;
      let featuresData = null;
      let bannersData = null;

      // Get hero/slider data
      const [sliders] = await this.pool.query(`
        SELECT ps.title, ps.next_available_text, sbd.title as box_title, sbd.subtitle, sbd.promocode,
               sbd.book_online_button_title, sbd.book_online_button_link,
               sbd.find_cbt_button_title, sbd.find_cbt_button_link
        FROM pageSliders ps
        LEFT JOIN sliderBoxData sbd ON ps.id = sbd.pageSliders_id
        LEFT JOIN course_events ce ON ps.page_course_id = ce.course_id
        WHERE ps.page_id = ?
      `, [page.id]);

      // Get all slider images
      const [sliderImages] = await this.pool.query(`
        SELECT psi.slider_image, psi.alt_title, psi.image_caption
        FROM pageSliders ps
        LEFT JOIN pageSliderImg psi ON ps.id = psi.pageSliders_id
        WHERE ps.page_id = ? AND ps.page_type = 'page' AND psi.slider_image IS NOT NULL
      `, [page.id]);

      let heroData = null;
      if (sliders.length > 0) {
        heroData = {
          backgroundImages: sliderImages.map(img => ({
            src: '/uploads/sliders/' + img.slider_image,
            alt: img.alt_title,
            title: img.image_caption
          })),
          nextCourse: {
            label: sliders[0].next_available_text || "Our Next Available CBT Course Is"
          },
          promotion: {
            title: sliders[0].box_title || null,
            subtitle: sliders[0].subtitle || null,
            promoCode: sliders[0].promocode || null,
            primaryCta: {
              text: sliders[0].book_online_button_title || null,
              link: sliders[0].book_online_button_link || null
            },
            secondaryCta: {
              text: sliders[0].find_cbt_button_title || null,
              link: sliders[0].find_cbt_button_link || null
            }
          },
          footerText: sliders[0].title || null
        };
      }

      // Get about/direct access data
      const [about] = await this.pool.query(`
        SELECT da.id, da.page_type, da.section_title, da.section_subtitle, da.content,
               dai.img_title, dai.access_img
        FROM direct_access da
        LEFT JOIN direct_access_image dai ON da.id = dai.direct_access_id
        WHERE da.page_id = ?
      `, [page.id]);

      if (about.length > 0) {
        aboutData = {
          id: about[0].id || null,
          page_type: about[0].page_type || null,
          title: about[0].section_title || null,
          subtitle: about[0].section_subtitle || null,
          content: about[0].content || null,
          images: about.filter(item => item.access_img).map(item => ({
            src: '/uploads/direct_access/' + item.access_img,
            alt: item.img_title || null
          }))
        };
      }

      // Get services data
      const [services] = await this.pool.query(`
        SELECT os.service_title,
               si.service_img, si.img_title, si.img_caption, si.service_url
        FROM our_services os
        LEFT JOIN service_images si ON os.id = si.service_id
        WHERE os.page_id = ?
      `, [page.id]);

      if (services.length > 0) {
        servicesData = {
          header: services[0].service_title || null,
          services: services.filter(item => item.service_img).map((item, index) => ({
            id: index + 1,
            title: item.img_title || null,
            description: item.img_caption || null,
            image: item.service_img ? `/uploads/services/${item.service_img}` : null,
            link: item.service_url || null
          }))
        };
      }

      // Get training slider data
      const [trainingSlider] = await this.pool.query(`
        SELECT ets.slider_title, ets.slider_subtitle,
               etsi.slider_img, etsi.slider_title as slide_title, etsi.img_caption
        FROM expert_training_slider ets
        LEFT JOIN expert_training_slider_images etsi ON ets.id = etsi.expert_training_slider_id
        WHERE ets.page_id = ?
      `, [page.id]);

      if (trainingSlider.length > 0) {
        trainingSliderData = {
          title: trainingSlider[0].slider_title || null,
          subtitle: trainingSlider[0].slider_subtitle || null,
          slides: trainingSlider.filter(item => item.slider_img).map((item, index) => ({
            id: index + 1,
            title: item.slide_title || null,
            image: item.slider_img ? '/uploads/expert_training/' + item.slider_img : null,
            link: "/" + (item.slide_title || "").toLowerCase().replace(/\s+/g, '-')
          }))
        };
      }

      // Get why us data
      const [whyUs] = await this.pool.query(`
        SELECT w1s.why_title, w1s.why_subtitle, w1s.why_content, w1s.why_footer_content,
               w1si.icon_title, w1si.icon_img, w1si.icon_content
        FROM why_1stop w1s
        LEFT JOIN why_1stop_images w1si ON w1s.id = w1si.why_id
        WHERE w1s.page_id = ?
      `, [page.id]);

      if (whyUs.length > 0) {
        whyUsData = {
          title: whyUs[0].why_title || null,
          description: whyUs[0].why_content || null,
          subtitle: whyUs[0].why_subtitle || null,
          footerText: whyUs[0].why_footer_content || null,
          courses: whyUs.filter(item => item.icon_title).map((item, index) => ({
            id: index + 1,
            title: item.icon_title,
            description: item.icon_content || null,
            icon: '/uploads/why_1stop/' + item.icon_img || null
          }))
        };
      }

      // Get CBT across London data
      const [cbtLondon] = await this.pool.query(`
        SELECT title, subtitle, description, cbt_image, marker_text, bg_color
        FROM cbt_across_london
        WHERE page_id = ?
      `, [page.id]);

      if (cbtLondon.length > 0) {
        cbtLondonData = {
          title: cbtLondon[0].title || null,
          subtitle: cbtLondon[0].subtitle || null,
          description: cbtLondon[0].description || null,
          marker_text: cbtLondon[0].marker_text || null,
          bg_color: !!cbtLondon[0].bg_color,
          image: cbtLondon[0].cbt_image ? `/uploads/cbt_across_london/${cbtLondon[0].cbt_image}` : null
        };
      }

      // Get CBT test London data
      const [cbtTestLondon] = await this.pool.query(`
        SELECT title, subtitle, description, cbt_image, marker_text, bg_color, title_top_center
        FROM cbt_test_london
        WHERE page_id = ?
      `, [page.id]);

      if (cbtTestLondon.length > 0) {
        cbtTestLondonData = {
          title: cbtTestLondon[0].title || null,
          subtitle: cbtTestLondon[0].subtitle || null,
          description: cbtTestLondon[0].description || null,
          marker_text: cbtTestLondon[0].marker_text || null,
          bg_color: !!cbtTestLondon[0].bg_color,
          title_top_center: cbtTestLondon[0].title_top_center || null,
          image: cbtTestLondon[0].cbt_image ? `/uploads/cbt_test_london/${cbtTestLondon[0].cbt_image}` : null
        };
      }

      // Get features data
      const [exceptional] = await this.pool.query(`
        SELECT exceptional_title, exceptional_subtitle, exceptional_content,
               button_title, button_link, exp_image
        FROM our_exceptional
        WHERE page_id = ?
      `, [page.id]);

      if (exceptional.length > 0) {
        featuresData = [{
          id: 'exceptional',
          title: exceptional[0].exceptional_title,
          subtitle: exceptional[0].exceptional_subtitle,
          content: exceptional[0].exceptional_content,
          image: '/uploads/exceptional/' + exceptional[0].exp_image,
          cta: {
            text: exceptional[0].button_title,
            link: exceptional[0].button_link
          }
        }];
      }

      // Get CTAs/banners data
      const [banners] = await this.pool.query(`
        SELECT bg_title, bg_image, button_title, button_link, bg_color, container_full_width, banner_position, title_color
        FROM pages_banner
        WHERE page_id = ?
        ORDER BY banner_position ASC
      `, [page.id]);

      if (banners.length > 0) {
        bannersData = banners.map((banner, index) => ({
          id: index + 1,
          title: banner.bg_title || null,
          backgroundImage: banner.bg_image ? `/uploads/pages_banner/${banner.bg_image}` : null,
          backgroundColor: banner.bg_color || null,
          containerFullWidth: banner.container_full_width === '1',
          position: banner.banner_position || 0,
          titleColor: banner.title_color || 0,
          cta: {
            text: banner.button_title || null,
            link: banner.button_link || null
          }
        }));
      }

      // Get info card section data
      let infoCardSectionData = [];
      const [infoCardSections] = await this.pool.query(`
        SELECT id, bg_color
        FROM info_card_section
        WHERE page_id = ?
        ORDER BY id ASC
      `, [page.id]);

      for (const section of infoCardSections) {
        const [infoCards] = await this.pool.query(`
          SELECT id, card_title, card_text, card_icon
          FROM info_card_data
          WHERE attached_to_card = ?
          ORDER BY id ASC
        `, [section.id]);

        infoCardSectionData.push({
          background: section.bg_color || null,
          cards: infoCards.map(card => ({
            icon: card.card_icon ? `/uploads/info_cards/${card.card_icon}` : null,
            title: card.card_title || null,
            description: card.card_text || null
          }))
        });
      }

      // Get price card section data
      let priceCardSectionData = [];
      const [priceCardSections] = await this.pool.query(`
        SELECT id, title, note, bottom_text
        FROM price_card_sections
        WHERE page_id = ?
        ORDER BY id ASC
      `, [page.id]);

      for (const section of priceCardSections) {
        const [priceCards] = await this.pool.query(`
          SELECT id, marker_text, title, package_time, price, package_content, note_text, button_text, button_url
          FROM price_card_data
          WHERE attached_price_card = ?
          ORDER BY id ASC
        `, [section.id]);

        priceCardSectionData.push({
          title: section.title || null,
          note: section.note || null,
          bottom_text: section.bottom_text || null,
          cards: priceCards.map(card => ({
            marker_text: card.marker_text || null,
            title: card.title || null,
            time: card.package_time || null,
            price: card.price || null,
            description: card.package_content || null,
            note_text: card.note_text || null,
            button: {
              text: card.button_text || null,
              url: card.button_url || null
            }
          }))
        });
      }

      // Get service areas section data
      let serviceAreasSectionData = [];
      const [serviceAreasSections] = await this.pool.query(`
        SELECT id, border, show_bg
        FROM service_areas_section
        WHERE page_id = ?
        ORDER BY id ASC
      `, [page.id]);

      for (const section of serviceAreasSections) {
        const [serviceAreas] = await this.pool.query(`
          SELECT id, left_text, right_text
          FROM service_areas_data
          WHERE attached_to_service = ?
          ORDER BY id ASC
        `, [section.id]);

        serviceAreasSectionData.push({
          border: !!section.border,
          show_bg: !!section.show_bg,
          areas: serviceAreas.map(area => ({
            left_text: area.left_text || null,
            right_text: area.right_text || null
          }))
        });
      }

      // Get accordion section data
      let accordionSectionData = [];
      const [accordionSections] = await this.pool.query(`
        SELECT id, header_txt
        FROM accordion_section
        WHERE page_id = ?
        ORDER BY id ASC
      `, [page.id]);

      for (const section of accordionSections) {
        const [accordionItems] = await this.pool.query(`
          SELECT id, accordion_title, accordion_text
          FROM accordion_sec_data
          WHERE ref_accordion = ?
          ORDER BY id ASC
        `, [section.id]);

        accordionSectionData.push({
          header: section.header_txt || null,
          items: accordionItems.map(item => ({
            title: item.accordion_title || null,
            content: item.accordion_text || null
          }))
        });
      }

      // Get content cards section data
      let contentCardsSectionData = [];
      const [contentCardsSections] = await this.pool.query(`
        SELECT id, content_text
        FROM content_cards_section
        WHERE page_id = ?
        ORDER BY id ASC
      `, [page.id]);

      for (const section of contentCardsSections) {
        const [contentCardItems] = await this.pool.query(`
          SELECT id, item_img_uri, item_title, item_text, red_btn_txt, red_btn_url, blue_btn_txt, blue_btn_url, marker_text
          FROM content_cards_items
          WHERE ref_content_card = ?
          ORDER BY id ASC
        `, [section.id]);

        contentCardsSectionData.push({
          content_text: section.content_text || null,
          cards: contentCardItems.map(item => ({
            image: item.item_img_uri ? `/uploads/content_cards/${item.item_img_uri}` : null,
            title: item.item_title || null,
            description: item.item_text || null,
            marker_text: item.marker_text || null,
            red_button: {
              text: item.red_btn_txt || null,
              url: item.red_btn_url || null
            },
            blue_button: {
              text: item.blue_btn_txt || null,
              url: item.blue_btn_url || null
            }
          }))
        });
      }

      // Get CMS sidebar data
      let cmsSidebarData = null;
      const [cmsSidebar] = await this.pool.query(`
        SELECT id, sidebar_item_title, sidebar_item_text, sort_order
        FROM cms_sidebar
        WHERE page_id = ?
        ORDER BY sort_order ASC
      `, [page.id]);

      if (cmsSidebar.length > 0) {
        cmsSidebarData = {
          items: cmsSidebar.map(item => ({
            title: item.sidebar_item_title || null,
            text: item.sidebar_item_text || null
          }))
        };
      }

      // Get tab section data
      let tabSectionData = [];
      const [tabSections] = await this.pool.query(`
        SELECT id, title, image_uri
        FROM tab_section
        WHERE page_id = ?
        ORDER BY id ASC
      `, [page.id]);

      for (const section of tabSections) {
        const [tabs] = await this.pool.query(`
          SELECT id, tab_name, tab_text, tab_icon_url
          FROM tabs
          WHERE attached_to_tab = ?
          ORDER BY id ASC
        `, [section.id]);

        tabSectionData.push({
          title: section.title || null,
          image: section.image_uri ? '/uploads/directions/' + section.image_uri : null,
          tabs: tabs.map(tab => ({
            id: tab.id.toString(),
            label: tab.tab_name || null,
            icon: tab.tab_icon_url ? '/uploads/tabs/' + tab.tab_icon_url : null,
            content: tab.tab_text || null
          }))
        });
      }

      // Get process steps section data
      let processStepsData = [];
      const [processStepsSections] = await this.pool.query(`
        SELECT id, process_step_title
        FROM process_steps
        WHERE page_id = ?
        ORDER BY id ASC
      `, [page.id]);

      for (const section of processStepsSections) {
        const [stepContent] = await this.pool.query(`
          SELECT id, step_no, step_title, step_description, sort_order
          FROM process_step_content
          WHERE main_process_ref = ?
          ORDER BY sort_order ASC
        `, [section.id]);

        processStepsData.push({
          title: section.process_step_title || null,
          steps: stepContent.map(step => ({
            step_no: step.step_no || null,
            title: step.step_title || null,
            description: step.step_description || null
          }))
        });
      }

      // Build sections array with type and order for dynamic rendering
      const pageSections = [];

      if (heroData) {
        pageSections.push({
          type: 'hero',
          order: getNextSectionOrder(['home_slider', 'hero', 'hero_section'], 1),
          data: heroData
        });
      }

      if (aboutData) {
        pageSections.push({
          type: 'about',
          order: getNextSectionOrder(['direct_access', 'about', 'about_section'], 10),
          data: aboutData
        });
      }

      if (servicesData) {
        pageSections.push({
          type: 'services',
          order: getNextSectionOrder(['our_services', 'services', 'services_section'], 20),
          data: servicesData
        });
      }

      if (trainingSliderData) {
        pageSections.push({
          type: 'training_slider',
          order: getNextSectionOrder(['expert_training_slider', 'training_slider'], 30),
          data: trainingSliderData
        });
      }

      if (whyUsData) {
        pageSections.push({
          type: 'why_us',
          order: getNextSectionOrder(['why_1stop', 'why_us', 'why_us_section'], 40),
          data: whyUsData
        });
      }

      if (cbtTestLondonData) {
        pageSections.push({
          type: 'cbt_test_london',
          order: getNextSectionOrder(['cheap_cbt_test_london', 'cbt_test_london'], 50),
          data: cbtTestLondonData
        });
      }

      if (cbtLondonData) {
        pageSections.push({
          type: 'cbt_london',
          order: getNextSectionOrder(['cheap_cbt_test_across_london', 'cbt_across_london', 'cbt_london'], 60),
          data: cbtLondonData
        });
      }

      // Add dynamic content sections
      // Each repeated section consumes its own page_junction order entry.
      sections.forEach((section) => {
        pageSections.push({
          type: 'dynamic_content',
          order: getNextSectionOrder(['dynamic_content', 'dynamic_content_sections'], 61),
          data: section
        });
      });

      if (infoCardSectionData.length > 0) {
        infoCardSectionData.forEach((sectionData) => {
          pageSections.push({
            type: 'info_card_section',
            order: getNextSectionOrder([
              'info_card_section',
              'info_cards_section',
              'info_card',
              'info_cards'
            ], 65),
            data: sectionData
          });
        });
      }

      if (priceCardSectionData.length > 0) {
        priceCardSectionData.forEach((sectionData) => {
          pageSections.push({
            type: 'price_card_section',
            order: getNextSectionOrder([
              'price_card_section',
              'price_cards_section',
              'price_card',
              'price_cards'
            ], 67),
            data: sectionData
          });
        });
      }

      if (serviceAreasSectionData.length > 0) {
        serviceAreasSectionData.forEach((sectionData) => {
          pageSections.push({
            type: 'service_areas_section',
            order: getNextSectionOrder([
              'service_areas_section',
              'service_area_section',
              'service_areas',
              'service_area'
            ], 68),
            data: sectionData
          });
        });
      }

      if (accordionSectionData.length > 0) {
        accordionSectionData.forEach((sectionData) => {
          pageSections.push({
            type: 'accordion_section',
            order: getNextSectionOrder([
              'accordion_section',
              'accordion_sections',
              'accordion',
              'accordion_sec'
            ], 69),
            data: sectionData
          });
        });
      }

      if (contentCardsSectionData.length > 0) {
        contentCardsSectionData.forEach((sectionData) => {
          pageSections.push({
            type: 'content_cards_section',
            order: getNextSectionOrder([
              'content_cards_section',
              'content_card_section',
              'content_cards',
              'content_card'
            ], 71),
            data: sectionData
          });
        });
      }

      if (cmsSidebarData) {
        pageSections.push({
          type: 'cms_sidebar',
          order: getNextSectionOrder(['cms_sidebar', 'sidebar', 'cms_sidebar_section'], 72),
          data: cmsSidebarData
        });
      }

      if (tabSectionData.length > 0) {
        tabSectionData.forEach((sectionData) => {
          pageSections.push({
            type: 'tab_section',
            order: getNextSectionOrder(['directions_parking', 'tab_section', 'tabs', 'tabs_section'], 70),
            data: sectionData
          });
        });
      }

      if (processStepsData.length > 0) {
        processStepsData.forEach((sectionData) => {
          pageSections.push({
            type: 'process_steps',
            order: getNextSectionOrder(['process_steps', 'process_step', 'process_steps_section'], 73),
            data: sectionData
          });
        });
      }

      if (featuresData) {
        pageSections.push({
          type: 'features',
          order: getNextSectionOrder(['our_exceptional', 'features', 'features_section'], 80),
          data: featuresData
        });
      }

      if (bannersData) {
        const bannersBaseOrder = getNextSectionOrder(['page_banner', 'pages_banner', 'banner', 'banners'], 90);
        bannersData.forEach((banner, index) => {
          pageSections.push({
            type: 'banner',
            order: bannersBaseOrder + ((banner.position || (index + 1)) / 1000),
            data: banner
          });
        });
      }

      // Sort sections by order
      pageSections.sort((a, b) => a.order - b.order);

      const responseData = {
        pages_menu,
        ...page,
        page_content: page.page_content ? page.page_content.trim().replace(/\r\n/g, '\n') : '',
        sections: pageSections
      };

      const processedData = await replaceTokensInObject(this.pool, responseData);

      res.json({
        success: true,
        data: processedData,
        debug: {
          page_id: page.id,
          sliders_count: sliders.length,
          slider_images_count: sliderImages.length,
          about_count: about.length,
          services_count: services.length,
          training_slider_count: trainingSlider.length,
          why_us_count: whyUs.length,
          cbt_london_count: cbtLondon.length,
          cbt_test_london_count: cbtTestLondon.length,
          exceptional_count: exceptional.length,
          banners_count: banners.length,
          info_card_section_count: infoCardSections.length,
          price_card_section_count: priceCardSections.length,
          service_areas_section_count: serviceAreasSections.length,
          accordion_section_count: accordionSections.length,
          content_cards_section_count: contentCardsSections.length,
          cms_sidebar_count: cmsSidebar.length,
          tab_section_count: tabSections.length,
          process_steps_count: processStepsSections.length
        }
      });

    } catch (error) {
      console.error('Error fetching page by nested slug:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch page by nested slug',
        error: error.message
      });
    }
  }
}

module.exports = CMSPagesController;