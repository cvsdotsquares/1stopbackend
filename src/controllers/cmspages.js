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
      let sliderImages = null;
      let aboutData = null;
      let servicesData = null;
      let trainingSliderData = null;
      let whyUsData = null;
      let cbtLondonData = null;
      let cbtTestLondonData = null;
      let featuresData = null;
      let bannersData = null;

      // Get slider images
      const [sliders] = await this.pool.query(`
        SELECT psi.slider_image, psi.alt_title, psi.image_caption
        FROM pageSliders ps
        LEFT JOIN pageSliderImg psi ON ps.id = psi.pageSliders_id
        WHERE ps.page_id = ? AND psi.slider_image IS NOT NULL
      `, [page.id]);

      if (sliders.length > 0) {
        sliderImages = sliders.map(img => ({
          src: '/uploads/sliders/' + img.slider_image,
          alt: img.alt_title,
          title: img.image_caption
        }));
      }

      // Get about/direct access data
      const [about] = await this.pool.query(`
        SELECT da.section_title, da.section_subtitle, da.content,
               dai.img_title, dai.access_img
        FROM direct_access da
        LEFT JOIN direct_access_image dai ON da.id = dai.direct_access_id
        WHERE da.page_id = ?
      `, [page.id]);

      if (about.length > 0) {
        aboutData = {
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
        SELECT title, subtitle, description, cbt_image
        FROM cbt_across_london
        WHERE page_id = ?
      `, [page.id]);

      if (cbtLondon.length > 0) {
        cbtLondonData = {
          title: cbtLondon[0].title || null,
          subtitle: cbtLondon[0].subtitle || null,
          description: cbtLondon[0].description || null,
          image: cbtLondon[0].cbt_image ? `/uploads/cbt_across_london/${cbtLondon[0].cbt_image}` : null
        };
      }

      // Get CBT test London data
      const [cbtTestLondon] = await this.pool.query(`
        SELECT title, subtitle, description, cbt_image
        FROM cbt_test_london
        WHERE page_id = ?
      `, [page.id]);

      if (cbtTestLondon.length > 0) {
        cbtTestLondonData = {
          title: cbtTestLondon[0].title || null,
          subtitle: cbtTestLondon[0].subtitle || null,
          description: cbtTestLondon[0].description || null,
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

      const responseData = {
        pages_menu,
        ...page,
        page_content: page.page_content ? page.page_content.trim().replace(/\r\n/g, '\n') : '',
        dynamic_sections: sections,
        slider_images: sliderImages,
        about: aboutData,
        services: servicesData,
        training_slider: trainingSliderData,
        why_us: whyUsData,
        cbt_london: cbtLondonData,
        cbt_test_london: cbtTestLondonData,
        features: featuresData,
        banners: bannersData
      };

      const processedData = await replaceTokensInObject(this.pool, responseData);

      res.json({
        success: true,
        data: processedData
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