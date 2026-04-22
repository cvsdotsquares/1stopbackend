// src/controllers/helper.js
const { replaceTokensInObject } = require('../utils/tokenReplacer');

class HelperController {
  constructor(pool) {
    this.pool = pool;
  }

  async checkBlacklisted(req, res) {
    try {
      const { license_number } = req.body;

      if (!license_number || license_number.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'License number is required'
        });
      }

      const [result] = await this.pool.query(`
        SELECT * FROM booking_attendees_dropdown
        WHERE id != '' AND is_blacklisted = 1 AND license_number = ?
      `, [license_number.trim()]);

      if (result.length > 0) {
        return res.json({
          success: true,
          is_blacklisted: true,
        });
      }

      res.json({
        success: true,
        is_blacklisted: false,
      });
    } catch (error) {
      console.error('Error checking blacklisted license:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check license number'
      });
    }
  }

  async suggestPostalCodes(req, res) {
    try {
      const { query } = req.body;

      if (!query || query.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Query must be at least 2 characters long'
        });
      }

      const [locations] = await this.pool.query(`
        SELECT DISTINCT l.postcode
        FROM locations l
        INNER JOIN location_course_pages lcp ON lcp.location_id = l.id AND lcp.is_active = 1
        LEFT JOIN courses c ON c.id = lcp.course_id
        WHERE l.postcode LIKE ? AND l.postcode IS NOT NULL AND l.postcode != ''
        ORDER BY l.postcode ASC
        LIMIT 10
      `, [`%${query}%`]);

      const suggestions = locations.map(row => row.postcode);

      res.json({
        success: true,
        data: suggestions
      });
    } catch (error) {
      console.error('Error fetching postal code suggestions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch postal code suggestions'
      });
    }
  }

  async getMenuStructure(req, res) {
    try {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Menu group ID is required'
        });
      }

      // Get group_name from menu_groups table
      const [menuGroup] = await this.pool.query(`
        SELECT group_name FROM menu_groups WHERE id = ?
      `, [id]);

      if (!menuGroup.length) {
        return res.status(404).json({
          success: false,
          message: 'Menu group not found'
        });
      }

      const groupName = menuGroup[0].group_name;

      // Get all menu items for this group
      const [menuItems] = await this.pool.query(`
        SELECT id, page_title, page_slug, parent_id, page_link_id, sort_order, front_menu_show
        FROM page_menus
        WHERE menu_group = ?
        ORDER BY id ASC
      `, [groupName]);

      // Build nested structure
      const buildMenuTree = (items, parentId = null) => {
        return items
          .filter(item => (item.front_menu_show === 0 && (item.parent_id === parentId || (parentId === null && (item.parent_id === null || item.parent_id === 0)))))
          .map(item => ({
            id: item.id,
            page_title: item.page_title,
            page_slug: item.page_slug,
            page_link_id: item.page_link_id,
            sort_order: item.sort_order,
            children: buildMenuTree(items, item.id)
          }));
      };

      const menuStructure = buildMenuTree(menuItems);
      const processedData = await replaceTokensInObject(this.pool, {
        group_name: groupName,
        menu_items: menuStructure
      });

      res.json({
        success: true,
        data: processedData
      });
    } catch (error) {
      console.error('Error fetching menu structure:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch menu structure'
      });
    }
  }

  async processContent(req, res) {
    try {
      const { content } = req.body;

      if (!content) {
        return res.status(400).json({
          success: false,
          message: 'Content is required'
        });
      }

      const processedContent = await replaceTokensInObject(this.pool, { content });

      res.json({
        success: true,
        data: processedContent
      });
    } catch (error) {
      console.error('Error processing content:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process content'
      });
    }
  }

  async getFooterData(req, res) {
    try {
      // Get footer blocks
      const [footerBlocks] = await this.pool.query(`
        SELECT page_content, footer_left_content
        FROM pages
        WHERE id = 73
      `);

      // Get footer menu sections - try all records first
      const [allFooterMenuSections] = await this.pool.query(`
        SELECT id, footer_menu_column, menu_weight, menu_status
        FROM footer_menu_section
        ORDER BY menu_weight ASC
      `);
      const [footerMenuSections] = await this.pool.query(`
        SELECT id, footer_menu_column, menu_weight
        FROM footer_menu_section
        ORDER BY menu_weight ASC
      `);

      // Get all footer links
      const [footerLinks] = await this.pool.query(`
        SELECT footer_link_title, navigation_type, footer_link_url, menu_column, weight
        FROM footer_links
        ORDER BY weight ASC
      `);

      // Get footer images
      const [footer_images] = await this.pool.query(`
        SELECT id, footer_type, image_name
        FROM footer_images
      `);
      // Get page slugs for navigation links
      const pageIds = footerLinks.map(link => link.navigation_type).filter(id => id);
      let pageMenus = [];
      if (pageIds.length > 0) {
        const [results] = await this.pool.query(`
          SELECT page_link_id, page_slug
          FROM page_menus
          WHERE page_link_id IN (${pageIds.map(() => '?').join(',')})
        `, pageIds);
        pageMenus = results;
      }

      // Create page slug lookup
      const pageSlugMap = {};
      pageMenus.forEach(page => {
        pageSlugMap[page.page_link_id] = page.page_slug;
      });

      const resolveFooterLinkUrl = (link) => {
        // Use footer_link_url if available (directly set in footer_links table)
        if (link.footer_link_url) {
          return link.footer_link_url;
        }

        // Use page slug from page_menus if navigation_type references a page
        if (pageSlugMap[link.navigation_type]) {
          return pageSlugMap[link.navigation_type];
        }

        // No URL found in database - return empty string
        return '';
      };

      // Build menu structure - support both legacy zero-based menu_column values
      // and newer direct footer_menu_section.id references.
      let menu = [];
      if (footerMenuSections.length > 0) {
        const normalizeLink = (link) => ({
          footer_link_title: link.footer_link_title,
          navigation_type: link.navigation_type,
          footer_link_url: resolveFooterLinkUrl(link),
          weight: link.weight
        });

        const buildMenuCandidate = (matcher) => {
          const assignedIndexes = new Set();
          const builtMenu = footerMenuSections.map((section, sectionIndex) => {
            const items = [];

            footerLinks.forEach((link, linkIndex) => {
              if (!assignedIndexes.has(linkIndex) && matcher(link, section, sectionIndex)) {
                assignedIndexes.add(linkIndex);
                items.push(normalizeLink(link));
              }
            });

            return {
              name: section.footer_menu_column,
              items
            };
          });

          const populatedSections = builtMenu.filter(group => group.items.length > 0).length;
          return {
            menu: builtMenu,
            assignedIndexes,
            assignedCount: assignedIndexes.size,
            populatedSections
          };
        };

        const candidates = [
          buildMenuCandidate((link, section) => Number(link.menu_column) === Number(section.id)),
          buildMenuCandidate((link, section) => Number(link.menu_column) === Number(section.menu_weight)),
          buildMenuCandidate((link, _section, sectionIndex) => Number(link.menu_column) === Number(sectionIndex))
        ];

        candidates.sort((a, b) => {
          if (b.assignedCount !== a.assignedCount) {
            return b.assignedCount - a.assignedCount;
          }

          return b.populatedSections - a.populatedSections;
        });

        const bestCandidate = candidates[0];

        // After choosing the best overall mapping, add any still-unassigned links that
        // explicitly reference a section id. This preserves links like menu_column = 2
        // even when the rest of the data uses legacy zero-based columns.
        footerLinks.forEach((link, linkIndex) => {
          if (bestCandidate.assignedIndexes.has(linkIndex)) {
            return;
          }

          const targetSectionIndex = footerMenuSections.findIndex(
            section => Number(section.id) === Number(link.menu_column)
          );

          if (targetSectionIndex !== -1) {
            bestCandidate.menu[targetSectionIndex].items.push(normalizeLink(link));
            bestCandidate.assignedIndexes.add(linkIndex);
          }
        });

        menu = bestCandidate.menu;

      } else {
        // Fallback: group by menu_column values
        const columnGroups = {};
        footerLinks.forEach(link => {
          if (!columnGroups[link.menu_column]) {
            columnGroups[link.menu_column] = [];
          }
          columnGroups[link.menu_column].push({
            footer_link_title: link.footer_link_title,
            navigation_type: link.navigation_type,
            footer_link_url: resolveFooterLinkUrl(link),
            weight: link.weight
          });
        });

        menu = Object.keys(columnGroups).map(columnId => ({
          name: `Menu Column ${columnId}`,
          items: columnGroups[columnId]
        }));
      }

      const footerData = {
        lhs_block: footerBlocks[0]?.footer_left_content || '',
        rhs_block: footerBlocks[0]?.page_content || '',
        menu,
        footer_images: footer_images.map(img => ({
          id: img.id,
          type: img.footer_type,
          src: img.image_name ? `/uploads/${img.image_name}` : null
        }))
      };

      // Process only the text blocks, keep menu as-is
      const processedBlocks = await replaceTokensInObject(this.pool, {
        lhs_block: footerData.lhs_block,
        rhs_block: footerData.rhs_block
      });

      const finalData = {
        ...processedBlocks,
        menu: footerData.menu,
        menu_imgs: footerData.footer_images
      };

      res.json({
        success: true,
        data: finalData
      });
    } catch (error) {
      console.error('Error fetching footer data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch footer data'
      });
    }
  }

  async getCounterData(req, res) {
    try {
      const [counterData] = await this.pool.query(`
        SELECT taining_centers, qualified_instructors, student_tainined, passing_rate
        FROM training_data

      `);
      if (!counterData.length) {
        return res.status(404).json({
          success: false,
          message: 'Counter data not found'
        });
      }

      const processedData = await replaceTokensInObject(this.pool, counterData[0]);

      res.json({
        success: true,
        data: processedData
      });
    } catch (error) {
      console.error('Error fetching counter data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch counter data'
      });
    }
  }

  async getLocationDetail(req, res) {
    try {
      const { slug } = req.params;

      const [locationData] = await this.pool.query(`
        SELECT id, location_id, course_id, page_title, content, meta_description, meta_keywords, locationPicture, slug
        FROM location_course_pages
        WHERE slug = ?
      `, [slug]);

      if (!locationData.length) {
        return res.status(404).json({
          success: false,
          message: 'Location not found'
        });
      }

      const location = locationData[0];
      const pageId = location.id;

      // Get dynamic content sections
      const [sections] = await this.pool.query(`
        SELECT *
        FROM dynamic_content_sections
        WHERE page_id = ?
        ORDER BY sort_order ASC
      `, [pageId]);

      for (let section of sections) {
        const [items] = await this.pool.query(`
          SELECT *
          FROM dynamic_content_items
          WHERE section_id = ?
          ORDER BY sort_order ASC
        `, [section.id]);
        section.items = items.map(item => ({
          ...item,
          item_content: item.item_content ? item.item_content.trim().replace(/\r\n/g, '\n') : ''
        }));
      }

      // Get homepage-style sections
      let sliderImages = null, aboutData = null, servicesData = null, trainingSliderData = null;
      let whyUsData = null, cbtLondonData = null, cbtTestLondonData = null, featuresData = null, bannersData = null;

      // Get slider images
      const [sliders] = await this.pool.query(`
        SELECT psi.slider_image, psi.alt_title, psi.image_caption
        FROM pageSliders ps
        LEFT JOIN pageSliderImg psi ON ps.id = psi.pageSliders_id
        WHERE ps.page_id = ? AND psi.slider_image IS NOT NULL
      `, [pageId]);
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
      `, [pageId]);
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
      `, [pageId]);
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
      `, [pageId]);
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
      `, [pageId]);
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
      `, [pageId]);
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
      `, [pageId]);
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
      `, [pageId]);
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
      `, [pageId]);
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
        ...location,
        content: location.content ? location.content.trim().replace(/\r\n/g, '\n') : '',
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
      console.error('Error fetching location detail:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch location detail'
      });
    }
  }

  async getCourseBulletPoints(req, res) {
    try {
      const { course_id } = req.body;

      if (!course_id) {
        return res.status(400).json({
          success: false,
          message: 'course_id is required'
        });
      }

      const [courses] = await this.pool.query(`
        SELECT id, course_name, course_bullet_points
        FROM courses
        WHERE id = ? AND status = '1' AND isDeleted = '0'
      `, [course_id]);

      if (courses.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Course not found'
        });
      }
      const processedData = await replaceTokensInObject(this.pool, { content: courses[0].course_bullet_points });
      res.json({
        success: true,
        data: {
          course_id: courses[0].id,
          course_name: courses[0].course_name,
          bullet_points: processedData.content
        }
      });

    } catch (error) {
      console.error('Error fetching course bullet points:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch course bullet points',
        error: error.message
      });
    }
  }

  async getTabSection(req, res) {
    try {
      const { page_id } = req.body;

      if (!page_id) {
        return res.status(400).json({
          success: false,
          message: 'page_id is required'
        });
      }

      // Get tab section (parent)
      const [tabSection] = await this.pool.query(`
        SELECT id, title, image_uri
        FROM tab_section
        WHERE page_id = ?
        LIMIT 1
      `, [page_id]);

      if (tabSection.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Tab section not found for this page'
        });
      }

      const section = tabSection[0];

      // Get all tabs for this section (children)
      const [tabs] = await this.pool.query(`
        SELECT id, tab_name, tab_text, tab_icon_url
        FROM tabs
        WHERE attached_to_tab = ?
        ORDER BY id ASC
      `, [section.id]);

      const response = {
        title: section.title || null,
        image: section.image_uri ? section.image_uri : null,
        tabs: tabs.map(tab => ({
          id: tab.id.toString(),
          label: tab.tab_name || null,
          icon: tab.tab_icon_url ? '/uploads/featured_services/' + tab.tab_icon_url : null,
          content: tab.tab_text || null
        }))
      };

      const processedData = await replaceTokensInObject(this.pool, response);

      res.json({
        success: true,
        data: processedData
      });

    } catch (error) {
      console.error('Error fetching tab section:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch tab section',
        error: error.message
      });
    }
  }
}

module.exports = HelperController;
