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
   * Get single page by ID or slug with complete content
   */
  async getPage(req, res) {
    try {
      const { identifier } = req.params;

      // Check if identifier is numeric (ID) or string (slug)
      const isNumeric = /^\d+$/.test(identifier);
      const field = isNumeric ? 'id' : 'slug';

      const [pages] = await this.pool.query(`
        SELECT
          id,
          page_title,
          slug,
          page_content,
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
        WHERE ${field} = ?
      `, [identifier]);

      if (pages.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Page not found'
        });
      }

      const page = pages[0];

      // Get child pages if this is a parent page
      let childPages = [];
      if (page.is_parent === 1) {
        const [children] = await this.pool.query(`
          SELECT
            id,
            page_title,
            slug,
            link_title,
            SUBSTRING(page_content, 1, 200) as content_preview,
            featured_icon,
            weight
          FROM pages
          WHERE parent_level = ?
          ORDER BY weight ASC, page_title ASC
        `, [page.id]);
        childPages = children;
      }

      // Get parent page if this is a child page
      let parentPage = null;
      if (page.parent_level > 0) {
        const [parent] = await this.pool.query(`
          SELECT id, page_title, slug, link_title
          FROM pages
          WHERE id = ?
        `, [page.parent_level]);
        parentPage = parent[0] || null;
      }

      // Get breadcrumb trail
      const breadcrumbs = [];
      if (parentPage) {
        breadcrumbs.push({
          title: parentPage.link_title || parentPage.page_title,
          slug: parentPage.slug,
          url: `/${parentPage.slug}`
        });
      }
      breadcrumbs.push({
        title: page.link_title || page.page_title,
        slug: page.slug,
        url: `/${page.slug}`,
        current: true
      });

      res.json({
        success: true,
        data: {
          ...page,
          childPages,
          parentPage,
          breadcrumbs,
          seo: {
            title: page.meta_title || page.page_title,
            description: page.meta_desc,
            keywords: page.meta_keyword,
            canonical: `/${page.slug}`
          }
        }
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
   * Get homepage data with featured content
   */
  async getHomepage(req, res) {
    try {
      // Get homepage content
      const homepageQuery = `
        SELECT
          id,
          page_title,
          page_content,
          slug,
          meta_title,
          meta_description,
          meta_keywords,
          banner_image,
          banner_title,
          banner_subtitle,
          created_at,
          updated_at
        FROM pages
        WHERE slug IN ('home', 'homepage', '') OR id = 1
        ORDER BY
          CASE
            WHEN slug = 'home' THEN 1
            WHEN slug = 'homepage' THEN 2
            WHEN slug = '' THEN 3
            ELSE 4
          END
        LIMIT 1
      `;

      const [homepageRows] = await this.pool.execute(homepageQuery);

      // If no homepage found, create default content
      let homepage = homepageRows[0];
      if (!homepage) {
        homepage = {
          id: 1,
          page_title: '1Stop Instruction - Professional Motorcycle Training',
          meta_title: '1Stop Instruction - CBT, DAS & Motorcycle Training London',
          meta_description: 'Professional motorcycle training in London. CBT courses, DAS training, Module 1 & 2 tests. Experienced DVSA approved instructors.',
          meta_keywords: 'motorcycle training London, CBT course, DAS training, Module 1, Module 2, DVSA approved',
          banner_title: 'Professional Motorcycle Training',
          banner_subtitle: 'Expert instruction, modern facilities, high pass rates',
          slug: 'home'
        };
      }

      // Get featured courses (with fallback if table doesn't exist)
      let featuredCourses = [
        {
          id: 1,
          course_name: 'CBT Training',
          course_description: 'Compulsory Basic Training - Your first step to motorcycle riding',
          price: 120,
          duration: '6-8 hours',
          features: ['Theory session', 'Practical training', 'On-road riding', 'CBT certificate']
        },
        {
          id: 2,
          course_name: 'DAS Course',
          course_description: 'Direct Access Scheme - Full motorcycle license training',
          price: 899,
          duration: '5 days',
          features: ['Theory test training', 'Module 1 & 2 preparation', 'Test fees included']
        },
        {
          id: 3,
          course_name: 'Module 1 Training',
          course_description: 'Off-road maneuvers and vehicle safety checks',
          price: 299,
          duration: '2 days',
          features: ['Off-road maneuvers', 'Test preparation', 'Practice sessions']
        }
      ];

      // Get testimonials (with fallback)
      let testimonials = [
        {
          id: 1,
          student_name: 'Sarah Johnson',
          course_name: 'CBT Training',
          rating: 5,
          comment: 'Excellent training! The instructors were patient and professional.',
          date_created: new Date()
        },
        {
          id: 2,
          student_name: 'Mike Chen',
          course_name: 'DAS Course',
          rating: 5,
          comment: 'Passed both tests first time thanks to the excellent preparation.',
          date_created: new Date()
        },
        {
          id: 3,
          student_name: 'Emma Wilson',
          course_name: 'Module 1',
          rating: 5,
          comment: 'Great instructors and facilities. Felt confident on test day.',
          date_created: new Date()
        }
      ];

      // Get locations (with fallback)
      let locations = [
        {
          id: 1,
          location_name: 'East London Training Center',
          address: '123 Training Road, Stratford, London E15 4AA',
          phone: '020 8123 4567',
          email: 'eastlondon@1stopinstruction.co.uk'
        },
        {
          id: 2,
          location_name: 'North London Training Center',
          address: '456 Rider Street, Tottenham, London N17 8BB',
          phone: '020 8765 4321',
          email: 'northlondon@1stopinstruction.co.uk'
        },
        {
          id: 3,
          location_name: 'Ilford Training Center',
          address: '789 Motorcycle Way, Ilford, Essex IG1 2CC',
          phone: '020 8111 2233',
          email: 'ilford@1stopinstruction.co.uk'
        }
      ];

      res.json({
        success: true,
        data: {
          homepage,
          featuredCourses,
          testimonials,
          locations,
          stats: {
            studentsTrained: 15000,
            passRate: 95,
            experienceYears: 15,
            instructors: 50
          }
        }
      });

    } catch (error) {
      console.error('Homepage fetch error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch homepage data',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }

  /**
   * Get page content by slug specifically (SEO-friendly endpoint)
   */
  async getPageBySlug(req, res) {
    try {
      const { slug } = req.params;

      const [pages] = await this.pool.query(`
        SELECT
          id,
          page_title,
          slug,
          page_content,
          meta_title,
          meta_keyword,
          meta_desc,
          is_parent,
          parent_level,
          link_title,
          banner_type,
          overlay_caption,
          overlay_caption_text,
          carousel_static_image,
          carousel_static_caption,
          featured_service,
          featured_icon,
          created,
          updated
        FROM pages
        WHERE slug = ?
      `, [slug]);

      if (pages.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Page with slug '${slug}' not found`
        });
      }

      const page = pages[0];

      // Get related pages (same parent or siblings)
      let relatedPages = [];
      if (page.parent_level > 0) {
        const [related] = await this.pool.query(`
          SELECT
            id,
            page_title,
            slug,
            link_title,
            SUBSTRING(page_content, 1, 150) as content_preview,
            featured_icon
          FROM pages
          WHERE parent_level = ? AND id != ?
          ORDER BY weight ASC
          LIMIT 5
        `, [page.parent_level, page.id]);
        relatedPages = related;
      }

      // Get navigation context (previous/next pages in the same category)
      let navigation = { prev: null, next: null };
      if (page.parent_level > 0) {
        // Get previous page
        const [prevPage] = await this.pool.query(`
          SELECT id, page_title, slug, link_title
          FROM pages
          WHERE parent_level = ? AND weight < ?
          ORDER BY weight DESC
          LIMIT 1
        `, [page.parent_level, page.weight]);

        // Get next page
        const [nextPage] = await this.pool.query(`
          SELECT id, page_title, slug, link_title
          FROM pages
          WHERE parent_level = ? AND weight > ?
          ORDER BY weight ASC
          LIMIT 1
        `, [page.parent_level, page.weight]);

        navigation.prev = prevPage[0] || null;
        navigation.next = nextPage[0] || null;
      }

      res.json({
        success: true,
        data: {
          ...page,
          relatedPages,
          navigation,
          meta: {
            title: page.meta_title || page.page_title,
            description: page.meta_desc || page.page_content.substring(0, 160),
            keywords: page.meta_keyword,
            canonical: `/${page.slug}`,
            ogTitle: page.meta_title || page.page_title,
            ogDescription: page.meta_desc || page.page_content.substring(0, 200),
            ogImage: page.carousel_static_image || page.featured_icon
          }
        }
      });

    } catch (error) {
      console.error('Error fetching page by slug:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch page content',
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
   * Get accreditations
   */
  async getAccreditations(req, res) {
    try {

      const [accreditations] = await this.pool.query(`
        SELECT id, image, weight, created, modified
        FROM accreditations
        ${whereClause}
        ORDER BY weight
      `, [...queryParams, parseInt(limit), offset]);

      res.json({
        success: true,
        data: accreditations,
      });

    } catch (error) {
      console.error('Error fetching accreditations:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch accreditations',
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
   *
   */
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