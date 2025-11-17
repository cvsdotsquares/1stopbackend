// src/controllers/cms.js
const { validationResult } = require('express-validator');

class CMSController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get all pages with pagination and filtering
   */
  async getPages(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        parent_id,
        featured,
        status = 'active'
      } = req.query;

      const offset = (page - 1) * limit;
      let whereClause = 'WHERE 1=1';
      let queryParams = [];

      // Add search filter
      if (search) {
        whereClause += ' AND (page_title LIKE ? OR page_content LIKE ? OR slug LIKE ?)';
        const searchPattern = `%${search}%`;
        queryParams.push(searchPattern, searchPattern, searchPattern);
      }

      // Add parent filter
      if (parent_id) {
        whereClause += ' AND parent_level = ?';
        queryParams.push(parent_id);
      }

      // Add featured filter
      if (featured === 'true') {
        whereClause += ' AND featured_service = 1';
      }

      // Get pages
      const [pages] = await this.pool.query(`
        SELECT 
          id,
          page_title,
          slug,
          SUBSTRING(page_content, 1, 300) as content_preview,
          meta_title,
          meta_keyword,
          meta_desc,
          is_parent,
          parent_level,
          link_title,
          banner_type,
          overlay_caption,
          overlay_caption_text,
          weight,
          carousel_static_image,
          carousel_static_caption,
          featured_service,
          featured_icon,
          footer_link,
          testimonial_display,
          featured_display,
          accreditation_display,
          created,
          updated
        FROM pages
        ${whereClause}
        ORDER BY weight ASC, created DESC
        LIMIT ? OFFSET ?
      `, [...queryParams, parseInt(limit), offset]);

      // Get total count
      const [countResult] = await this.pool.query(`
        SELECT COUNT(*) as total
        FROM pages
        ${whereClause}
      `, queryParams);

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      res.json({
        success: true,
        data: pages,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });

    } catch (error) {
      console.error('Error fetching pages:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch pages',
        error: error.message
      });
    }
  }

  /**
   * Get single page by ID or slug
   */
  async getPage(req, res) {
    try {
      const { identifier } = req.params;
      
      // Check if identifier is numeric (ID) or string (slug)
      const isNumeric = /^\d+$/.test(identifier);
      const field = isNumeric ? 'id' : 'slug';
      
      const [pages] = await this.pool.query(`
        SELECT * FROM pages WHERE ${field} = ?
      `, [identifier]);

      if (pages.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Page not found'
        });
      }

      res.json({
        success: true,
        data: pages[0]
      });

    } catch (error) {
      console.error('Error fetching page:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch page',
        error: error.message
      });
    }
  }

  /**
   * Create new page (Admin only)
   */
  async createPage(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const {
        page_title,
        slug,
        page_content,
        internal_css = '',
        meta_title = '',
        meta_keyword = '',
        meta_desc = '',
        is_parent = 0,
        parent_level = 0,
        link_title,
        banner_type = 1,
        overlay_caption = 0,
        overlay_caption_text = '',
        weight = 0,
        carousel_static_image = '',
        carousel_static_caption = '',
        page_ex_rhs = '',
        featured_service = 0,
        featured_icon = '',
        footer_link = 1,
        testimonial_display = 1,
        featured_display = 1,
        accreditation_display = 1
      } = req.body;

      const [result] = await this.pool.query(`
        INSERT INTO pages (
          page_title, slug, page_content, internal_css, meta_title, meta_keyword, meta_desc,
          is_parent, parent_level, link_title, banner_type, overlay_caption, overlay_caption_text,
          weight, carousel_static_image, carousel_static_caption, page_ex_rhs, featured_service,
          featured_icon, footer_link, testimonial_display, featured_display, accreditation_display,
          created, updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `, [
        page_title, slug, page_content, internal_css, meta_title, meta_keyword, meta_desc,
        is_parent, parent_level, link_title, banner_type, overlay_caption, overlay_caption_text,
        weight, carousel_static_image, carousel_static_caption, page_ex_rhs, featured_service,
        featured_icon, footer_link, testimonial_display, featured_display, accreditation_display
      ]);

      res.status(201).json({
        success: true,
        message: 'Page created successfully',
        data: { id: result.insertId }
      });

    } catch (error) {
      console.error('Error creating page:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create page',
        error: error.message
      });
    }
  }

  /**
   * Update page (Admin only)
   */
  async updatePage(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const { id } = req.params;
      const updateFields = req.body;

      // Build dynamic update query
      const fields = Object.keys(updateFields).filter(key => key !== 'id');
      const setClause = fields.map(field => `${field} = ?`).join(', ');
      const values = fields.map(field => updateFields[field]);

      if (fields.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }

      values.push(id);

      const [result] = await this.pool.query(`
        UPDATE pages 
        SET ${setClause}, updated = NOW()
        WHERE id = ?
      `, values);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Page not found'
        });
      }

      res.json({
        success: true,
        message: 'Page updated successfully'
      });

    } catch (error) {
      console.error('Error updating page:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update page',
        error: error.message
      });
    }
  }

  /**
   * Delete page (Admin only)
   */
  async deletePage(req, res) {
    try {
      const { id } = req.params;

      const [result] = await this.pool.query(`
        DELETE FROM pages WHERE id = ?
      `, [id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Page not found'
        });
      }

      res.json({
        success: true,
        message: 'Page deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting page:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete page',
        error: error.message
      });
    }
  }

  /**
   * Get testimonials with pagination
   */
  async getTestimonials(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        status = 'active'
      } = req.query;

      const offset = (page - 1) * limit;
      let whereClause = '';
      let queryParams = [];

      if (status === 'active') {
        whereClause = 'WHERE status = 1';
      } else if (status === 'inactive') {
        whereClause = 'WHERE status = 0';
      }

      const [testimonials] = await this.pool.query(`
        SELECT id, review, review_name, status, created
        FROM testimonials
        ${whereClause}
        ORDER BY created DESC
        LIMIT ? OFFSET ?
      `, [...queryParams, parseInt(limit), offset]);

      // Get total count
      const [countResult] = await this.pool.query(`
        SELECT COUNT(*) as total
        FROM testimonials
        ${whereClause}
      `, queryParams);

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      res.json({
        success: true,
        data: testimonials,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      });

    } catch (error) {
      console.error('Error fetching testimonials:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch testimonials',
        error: error.message
      });
    }
  }

  /**
   * Create testimonial
   */
  async createTestimonial(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const { review, review_name, status = 0 } = req.body;

      const [result] = await this.pool.query(`
        INSERT INTO testimonials (review, review_name, status, created)
        VALUES (?, ?, ?, NOW())
      `, [review, review_name, status]);

      res.status(201).json({
        success: true,
        message: 'Testimonial created successfully',
        data: { id: result.insertId }
      });

    } catch (error) {
      console.error('Error creating testimonial:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create testimonial',
        error: error.message
      });
    }
  }

  /**
   * Get FAQs with categories
   */
  async getFAQs(req, res) {
    try {
      const { category_id } = req.query;
      let whereClause = 'WHERE f.status = 1';
      let queryParams = [];

      if (category_id) {
        whereClause += ' AND f.category_id = ?';
        queryParams.push(category_id);
      }

      const [faqs] = await this.pool.query(`
        SELECT 
          f.id,
          f.faq_title,
          f.content,
          f.category_id,
          f.weight,
          f.created,
          fc.category_name
        FROM faqs f
        JOIN faq_categories fc ON f.category_id = fc.id
        ${whereClause}
        ORDER BY f.weight ASC, f.created DESC
      `, queryParams);

      // Also get categories
      const [categories] = await this.pool.query(`
        SELECT id, category_name
        FROM faq_categories
        ORDER BY weight ASC
      `);

      res.json({
        success: true,
        data: {
          faqs: faqs,
          categories: categories
        }
      });

    } catch (error) {
      console.error('Error fetching FAQs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch FAQs',
        error: error.message
      });
    }
  }

  /**
   * Get carousels/sliders
   */
  async getCarousels(req, res) {
    try {
      const [carousels] = await this.pool.query(`
        SELECT id, carousel_banner, caption, weight, created
        FROM carousels
        ORDER BY weight ASC, created DESC
      `);

      res.json({
        success: true,
        data: carousels
      });

    } catch (error) {
      console.error('Error fetching carousels:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch carousels',
        error: error.message
      });
    }
  }

  /**
   * Get site settings
   */
  async getSettings(req, res) {
    try {
      const [settings] = await this.pool.query(`
        SELECT 
          site_contact,
          site_email,
          facebook_link,
          twitter_link,
          linkedin_link,
          youtube_link,
          admin_logo_url,
          mobile_logo_url,
          vat_rate,
          credit_card_surcharge,
          paypal_surcharge
        FROM settings
        WHERE id = 1
      `);

      if (settings.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Settings not found'
        });
      }

      res.json({
        success: true,
        data: settings[0]
      });

    } catch (error) {
      console.error('Error fetching settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch settings',
        error: error.message
      });
    }
  }

  /**
   * Get page hierarchy/menu structure
   */
  async getPageHierarchy(req, res) {
    try {
      const [pages] = await this.pool.query(`
        SELECT 
          id,
          page_title,
          slug,
          link_title,
          is_parent,
          parent_level,
          weight,
          footer_link,
          featured_service
        FROM pages
        ORDER BY parent_level ASC, weight ASC, page_title ASC
      `);

      // Build hierarchy
      const hierarchy = {};
      const rootPages = [];

      pages.forEach(page => {
        if (page.parent_level === 0) {
          page.children = [];
          rootPages.push(page);
          hierarchy[page.id] = page;
        }
      });

      pages.forEach(page => {
        if (page.parent_level !== 0 && hierarchy[page.parent_level]) {
          hierarchy[page.parent_level].children.push(page);
        }
      });

      res.json({
        success: true,
        data: {
          pages: rootPages,
          footer_pages: pages.filter(p => p.footer_link === 1),
          featured_services: pages.filter(p => p.featured_service === 1)
        }
      });

    } catch (error) {
      console.error('Error fetching page hierarchy:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch page hierarchy',
        error: error.message
      });
    }
  }
}

module.exports = CMSController;