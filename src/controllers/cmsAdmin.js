// src/controllers/cmsAdmin.js
const { validationResult } = require('express-validator');

class CMSAdminController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get comprehensive CMS dashboard statistics
   */
  async getDashboardStats(req, res) {
    try {
      // Get pages statistics
      const [pagesStats] = await this.pool.query(`
        SELECT 
          COUNT(*) as total_pages,
          COUNT(CASE WHEN featured_service = 1 THEN 1 END) as featured_pages,
          COUNT(CASE WHEN footer_link = 1 THEN 1 END) as footer_pages,
          COUNT(CASE WHEN is_parent = 1 THEN 1 END) as parent_pages
        FROM pages
      `);

      // Get testimonials statistics
      const [testimonialsStats] = await this.pool.query(`
        SELECT 
          COUNT(*) as total_testimonials,
          COUNT(CASE WHEN status = 1 THEN 1 END) as active_testimonials,
          COUNT(CASE WHEN status = 0 THEN 1 END) as pending_testimonials
        FROM testimonials
      `);

      // Get FAQs statistics
      const [faqsStats] = await this.pool.query(`
        SELECT 
          COUNT(*) as total_faqs,
          COUNT(CASE WHEN f.status = 1 THEN 1 END) as active_faqs,
          COUNT(DISTINCT f.category_id) as faq_categories
        FROM faqs f
      `);

      // Get carousels statistics
      const [carouselStats] = await this.pool.query(`
        SELECT COUNT(*) as total_carousels
        FROM carousels
      `);

      // Get recent page updates
      const [recentPages] = await this.pool.query(`
        SELECT id, page_title, slug, updated
        FROM pages
        WHERE updated IS NOT NULL
        ORDER BY updated DESC
        LIMIT 5
      `);

      res.json({
        success: true,
        data: {
          statistics: {
            pages: pagesStats[0],
            testimonials: testimonialsStats[0],
            faqs: faqsStats[0],
            carousels: carouselStats[0]
          },
          recent_updates: recentPages
        }
      });

    } catch (error) {
      console.error('Error fetching CMS dashboard stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch CMS dashboard statistics',
        error: error.message
      });
    }
  }

  /**
   * Bulk update page statuses or properties
   */
  async bulkUpdatePages(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const { page_ids, updates } = req.body;

      if (!Array.isArray(page_ids) || page_ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'page_ids must be a non-empty array'
        });
      }

      // Build dynamic update query
      const fields = Object.keys(updates);
      const setClause = fields.map(field => `${field} = ?`).join(', ');
      const values = fields.map(field => updates[field]);

      if (fields.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update'
        });
      }

      // Create placeholders for IN clause
      const placeholders = page_ids.map(() => '?').join(',');
      values.push(...page_ids);

      const [result] = await this.pool.query(`
        UPDATE pages 
        SET ${setClause}, updated = NOW()
        WHERE id IN (${placeholders})
      `, values);

      res.json({
        success: true,
        message: `Updated ${result.affectedRows} pages successfully`,
        affected_rows: result.affectedRows
      });

    } catch (error) {
      console.error('Error bulk updating pages:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to bulk update pages',
        error: error.message
      });
    }
  }

  /**
   * Update testimonial status (approve/reject)
   */
  async updateTestimonialStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (![0, 1].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Status must be 0 (inactive) or 1 (active)'
        });
      }

      const [result] = await this.pool.query(`
        UPDATE testimonials 
        SET status = ?
        WHERE id = ?
      `, [status, id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Testimonial not found'
        });
      }

      res.json({
        success: true,
        message: `Testimonial ${status === 1 ? 'approved' : 'rejected'} successfully`
      });

    } catch (error) {
      console.error('Error updating testimonial status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update testimonial status',
        error: error.message
      });
    }
  }

  /**
   * Create or update FAQ
   */
  async manageFAQ(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const { id } = req.params; // Optional for update
      const { faq_title, content, category_id, weight = 0, status = 1 } = req.body;

      if (id) {
        // Update existing FAQ
        const [result] = await this.pool.query(`
          UPDATE faqs 
          SET faq_title = ?, content = ?, category_id = ?, weight = ?, status = ?
          WHERE id = ?
        `, [faq_title, content, category_id, weight, status, id]);

        if (result.affectedRows === 0) {
          return res.status(404).json({
            success: false,
            message: 'FAQ not found'
          });
        }

        res.json({
          success: true,
          message: 'FAQ updated successfully'
        });
      } else {
        // Create new FAQ
        const [result] = await this.pool.query(`
          INSERT INTO faqs (faq_title, content, category_id, weight, status, created)
          VALUES (?, ?, ?, ?, ?, NOW())
        `, [faq_title, content, category_id, weight, status]);

        res.status(201).json({
          success: true,
          message: 'FAQ created successfully',
          data: { id: result.insertId }
        });
      }

    } catch (error) {
      console.error('Error managing FAQ:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to manage FAQ',
        error: error.message
      });
    }
  }

  /**
   * Manage carousel items
   */
  async manageCarousel(req, res) {
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
      const { carousel_banner, caption = '', weight = 0 } = req.body;

      if (id) {
        // Update existing carousel
        const [result] = await this.pool.query(`
          UPDATE carousels 
          SET carousel_banner = ?, caption = ?, weight = ?
          WHERE id = ?
        `, [carousel_banner, caption, weight, id]);

        if (result.affectedRows === 0) {
          return res.status(404).json({
            success: false,
            message: 'Carousel item not found'
          });
        }

        res.json({
          success: true,
          message: 'Carousel item updated successfully'
        });
      } else {
        // Create new carousel
        const [result] = await this.pool.query(`
          INSERT INTO carousels (carousel_banner, caption, weight, created)
          VALUES (?, ?, ?, NOW())
        `, [carousel_banner, caption, weight]);

        res.status(201).json({
          success: true,
          message: 'Carousel item created successfully',
          data: { id: result.insertId }
        });
      }

    } catch (error) {
      console.error('Error managing carousel:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to manage carousel',
        error: error.message
      });
    }
  }

  /**
   * Update site settings
   */
  async updateSettings(req, res) {
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
        site_contact,
        site_email,
        facebook_link,
        twitter_link,
        linkedin_link,
        youtube_link,
        vat_rate,
        credit_card_surcharge,
        paypal_surcharge
      } = req.body;

      const [result] = await this.pool.query(`
        UPDATE settings 
        SET 
          site_contact = ?,
          site_email = ?,
          facebook_link = ?,
          twitter_link = ?,
          linkedin_link = ?,
          youtube_link = ?,
          vat_rate = ?,
          credit_card_surcharge = ?,
          paypal_surcharge = ?
        WHERE id = 1
      `, [
        site_contact,
        site_email,
        facebook_link,
        twitter_link,
        linkedin_link,
        youtube_link,
        vat_rate,
        credit_card_surcharge,
        paypal_surcharge
      ]);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Settings not found'
        });
      }

      res.json({
        success: true,
        message: 'Settings updated successfully'
      });

    } catch (error) {
      console.error('Error updating settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update settings',
        error: error.message
      });
    }
  }

  /**
   * Search across all CMS content
   */
  async globalSearch(req, res) {
    try {
      const { query, type } = req.query;

      if (!query) {
        return res.status(400).json({
          success: false,
          message: 'Search query is required'
        });
      }

      const searchPattern = `%${query}%`;
      let results = {};

      // Search pages if no type specified or type is 'pages'
      if (!type || type === 'pages') {
        const [pages] = await this.pool.query(`
          SELECT id, page_title, slug, 'page' as type
          FROM pages
          WHERE page_title LIKE ? OR page_content LIKE ? OR slug LIKE ?
          ORDER BY page_title
          LIMIT 10
        `, [searchPattern, searchPattern, searchPattern]);
        results.pages = pages;
      }

      // Search testimonials
      if (!type || type === 'testimonials') {
        const [testimonials] = await this.pool.query(`
          SELECT id, review_name, SUBSTRING(review, 1, 100) as preview, 'testimonial' as type
          FROM testimonials
          WHERE review LIKE ? OR review_name LIKE ?
          ORDER BY created DESC
          LIMIT 10
        `, [searchPattern, searchPattern]);
        results.testimonials = testimonials;
      }

      // Search FAQs
      if (!type || type === 'faqs') {
        const [faqs] = await this.pool.query(`
          SELECT f.id, f.faq_title, SUBSTRING(f.content, 1, 100) as preview, 'faq' as type
          FROM faqs f
          WHERE f.faq_title LIKE ? OR f.content LIKE ?
          ORDER BY f.weight ASC
          LIMIT 10
        `, [searchPattern, searchPattern]);
        results.faqs = faqs;
      }

      res.json({
        success: true,
        data: results,
        query: query,
        total_results: Object.values(results).reduce((sum, arr) => sum + arr.length, 0)
      });

    } catch (error) {
      console.error('Error performing global search:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to perform global search',
        error: error.message
      });
    }
  }

  /**
   * Export CMS content to backup format
   */
  async exportContent(req, res) {
    try {
      const { type = 'all' } = req.query;
      let exportData = {};

      if (type === 'all' || type === 'pages') {
        const [pages] = await this.pool.query(`SELECT * FROM pages ORDER BY weight ASC, created DESC`);
        exportData.pages = pages;
      }

      if (type === 'all' || type === 'testimonials') {
        const [testimonials] = await this.pool.query(`SELECT * FROM testimonials ORDER BY created DESC`);
        exportData.testimonials = testimonials;
      }

      if (type === 'all' || type === 'faqs') {
        const [faqs] = await this.pool.query(`
          SELECT f.*, fc.category_name
          FROM faqs f
          JOIN faq_categories fc ON f.category_id = fc.id
          ORDER BY f.weight ASC
        `);
        exportData.faqs = faqs;
      }

      if (type === 'all' || type === 'carousels') {
        const [carousels] = await this.pool.query(`SELECT * FROM carousels ORDER BY weight ASC`);
        exportData.carousels = carousels;
      }

      if (type === 'all' || type === 'settings') {
        const [settings] = await this.pool.query(`SELECT * FROM settings WHERE id = 1`);
        exportData.settings = settings[0];
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="cms-export-${Date.now()}.json"`);
      
      res.json({
        success: true,
        export_date: new Date().toISOString(),
        export_type: type,
        data: exportData
      });

    } catch (error) {
      console.error('Error exporting content:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export content',
        error: error.message
      });
    }
  }
}

module.exports = CMSAdminController;