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
          is_parent, parent_level, link_title, banner_type, overlay_caption, overlay_caption_text,
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

      res.json({
        success: true,
        data: {
          ...page,
          dynamic_sections: sections
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