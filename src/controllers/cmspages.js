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

      // Get page by slug
      const [pages] = await this.pool.query(`
        SELECT
          id, page_title, slug , meta_title, meta_keyword, meta_desc,
          is_parent, parent_level, link_title, banner_type, overlay_caption, page_content, overlay_caption_text,
          weight, carousel_static_image, carousel_static_caption, featured_service, featured_icon,
          footer_link, testimonial_display, featured_display, accreditation_display, created, updated
        FROM pages
        WHERE slug = ?
      `, [fullPath]);

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
        section.items = items;
      }

      // Initialize additional sections
      let testimonials = null;
      let featuredServices = null;
      let accreditations = null;

      // Get testimonials if enabled
      if (page.testimonial_display === 1) {
        const [testimonialsData] = await this.pool.query(`
          SELECT id, review, review_name, status, created
          FROM testimonials
          WHERE status = 1
          ORDER BY created DESC
          LIMIT 10
        `);
        testimonials = testimonialsData;
      }

      // Get featured services if enabled
      if (page.featured_display === 1) {
        const [featuredData] = await this.pool.query(`
          SELECT id, page_title, slug, link_title, featured_icon, page_content
          FROM pages
          WHERE featured_service = 1
          ORDER BY weight ASC
        `);
        featuredServices = featuredData;
      }

      // Get accreditations if enabled
      if (page.accreditation_display === 1) {
        const [accreditationsData] = await this.pool.query(`
          SELECT id, image, weight
          FROM accreditations
          ORDER BY weight ASC
        `);
        accreditations = accreditationsData.map(acc => ({
          ...acc,
          image_url: acc.image ? `/uploads/accreditations/${acc.image}` : null
        }));
      }

      const responseData = {
        ...page,
        dynamic_sections: sections,
        testimonials,
        featured_services: featuredServices,
        accreditations
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