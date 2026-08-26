// src/routes/cms.js
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const CMSController = require('../controllers/cms');

// Simple authentication middleware for admin routes
const adminAuthMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required for admin operations'
    });
  }
  
  // For now, skip JWT validation - can be added later
  // This allows testing admin endpoints
  req.user = { id: 1, isAdmin: true };
  next();
};

module.exports = (pool) => {
  const cmsController = new CMSController(pool);

  // Page validation middleware
  const pageValidation = [
    body('page_title')
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage('Page title must be between 1 and 255 characters'),
    body('slug')
      .trim()
      .isLength({ min: 1, max: 255 })
      .matches(/^[a-z0-9-]+$/)
      .withMessage('Slug must contain only lowercase letters, numbers, and hyphens'),
    body('page_content')
      .trim()
      .isLength({ min: 1 })
      .withMessage('Page content is required'),
    body('meta_title')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Meta title must not exceed 255 characters'),
    body('meta_keyword')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Meta keywords must not exceed 500 characters'),
    body('meta_desc')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Meta description must not exceed 500 characters'),
    body('weight')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Weight must be a positive integer'),
    body('is_parent')
      .optional()
      .isIn([0, 1])
      .withMessage('is_parent must be 0 or 1'),
    body('parent_level')
      .optional()
      .isInt({ min: 0 })
      .withMessage('parent_level must be a positive integer'),
    body('featured_service')
      .optional()
      .isIn([0, 1])
      .withMessage('featured_service must be 0 or 1')
  ];

  // Testimonial validation middleware
  const testimonialValidation = [
    body('review')
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage('Review must be between 10 and 1000 characters'),
    body('review_name')
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Reviewer name must be between 1 and 100 characters'),
    body('status')
      .optional()
      .isIn([0, 1])
      .withMessage('Status must be 0 or 1')
  ];

  // Public CMS Routes (No authentication required)
  
  /**
   * @route GET /api/cms/homepage
   * @desc Get homepage data with featured content
   * @access Public
   */
  router.get('/homepage', cmsController.getHomepage.bind(cmsController));

  /**
   * @route GET /api/cms/pages
   * @desc Get all pages with pagination and filtering
   * @access Public
   */
  router.get('/pages', cmsController.getPages.bind(cmsController));

  /**
   * @route GET /api/cms/pages/:identifier
   * @desc Get single page by ID or slug
   * @access Public
   */
  router.get('/pages/:identifier', cmsController.getPage.bind(cmsController));

  /**
   * @route GET /api/cms/page/slug/:slug
   * @desc Get complete page content by slug with SEO data and related pages
   * @access Public
   */
  router.get('/page/slug/:slug', cmsController.getPageBySlug.bind(cmsController));

  /**
   * @route GET /api/cms/testimonials
   * @desc Get testimonials with pagination
   * @access Public
   */
  router.get('/testimonials', cmsController.getTestimonials.bind(cmsController));

  /**
   * @route GET /api/cms/faqs
   * @desc Get FAQs with categories
   * @access Public
   */
  router.get('/faqs', cmsController.getFAQs.bind(cmsController));

  /**
   * @route GET /api/cms/carousels
   * @desc Get carousel/slider images
   * @access Public
   */
  router.get('/carousels', cmsController.getCarousels.bind(cmsController));

  /**
   * @route GET /api/cms/settings
   * @desc Get site settings (contact info, social links, etc.)
   * @access Public
   */
  router.get('/settings', cmsController.getSettings.bind(cmsController));

  /**
   * @route GET /api/cms/menu
   * @desc Get page hierarchy for navigation menu
   * @access Public
   */
  router.get('/menu', cmsController.getPageHierarchy.bind(cmsController));

  // Admin CMS Routes (Authentication required)

  /**
   * @route POST /api/cms/pages
   * @desc Create new page
   * @access Admin only
   */
  router.post('/pages', 
    adminAuthMiddleware, 
    pageValidation, 
    cmsController.createPage.bind(cmsController)
  );

  /**
   * @route PUT /api/cms/pages/:id
   * @desc Update page
   * @access Admin only
   */
  router.put('/pages/:id', 
    adminAuthMiddleware, 
    pageValidation, 
    cmsController.updatePage.bind(cmsController)
  );

  /**
   * @route DELETE /api/cms/pages/:id
   * @desc Delete page
   * @access Admin only
   */
  router.delete('/pages/:id', 
    adminAuthMiddleware, 
    cmsController.deletePage.bind(cmsController)
  );

  /**
   * @route POST /api/cms/testimonials
   * @desc Create new testimonial
   * @access Public (but defaults to inactive status for moderation)
   */
  router.post('/testimonials', 
    testimonialValidation, 
    cmsController.createTestimonial.bind(cmsController)
  );

  // Import admin controller for advanced operations
  const CMSAdminController = require('../controllers/cmsAdmin');
  const cmsAdminController = new CMSAdminController(pool);

  // Advanced Admin CMS Routes
  
  /**
   * @route GET /api/cms/admin/dashboard
   * @desc Get CMS dashboard statistics
   * @access Admin only
   */
  router.get('/admin/dashboard', 
    adminAuthMiddleware, 
    cmsAdminController.getDashboardStats.bind(cmsAdminController)
  );

  /**
   * @route PUT /api/cms/admin/pages/bulk-update
   * @desc Bulk update multiple pages
   * @access Admin only
   */
  router.put('/admin/pages/bulk-update', 
    adminAuthMiddleware,
    [
      body('page_ids').isArray({ min: 1 }).withMessage('page_ids must be a non-empty array'),
      body('updates').isObject().withMessage('updates must be an object')
    ],
    cmsAdminController.bulkUpdatePages.bind(cmsAdminController)
  );

  /**
   * @route PUT /api/cms/admin/testimonials/:id/status
   * @desc Update testimonial status (approve/reject)
   * @access Admin only
   */
  router.put('/admin/testimonials/:id/status', 
    adminAuthMiddleware,
    [
      body('status').isIn([0, 1]).withMessage('Status must be 0 or 1')
    ],
    cmsAdminController.updateTestimonialStatus.bind(cmsAdminController)
  );

  /**
   * @route POST /api/cms/admin/faqs
   * @desc Create new FAQ
   * @access Admin only
   */
  router.post('/admin/faqs', 
    adminAuthMiddleware,
    [
      body('faq_title').trim().isLength({ min: 1, max: 255 }).withMessage('FAQ title is required'),
      body('content').trim().isLength({ min: 1 }).withMessage('FAQ content is required'),
      body('category_id').isInt({ min: 1 }).withMessage('Valid category ID is required')
    ],
    cmsAdminController.manageFAQ.bind(cmsAdminController)
  );

  /**
   * @route PUT /api/cms/admin/faqs/:id
   * @desc Update FAQ
   * @access Admin only
   */
  router.put('/admin/faqs/:id', 
    adminAuthMiddleware,
    [
      body('faq_title').trim().isLength({ min: 1, max: 255 }).withMessage('FAQ title is required'),
      body('content').trim().isLength({ min: 1 }).withMessage('FAQ content is required'),
      body('category_id').isInt({ min: 1 }).withMessage('Valid category ID is required')
    ],
    cmsAdminController.manageFAQ.bind(cmsAdminController)
  );

  /**
   * @route POST /api/cms/admin/carousels
   * @desc Create new carousel item
   * @access Admin only
   */
  router.post('/admin/carousels', 
    adminAuthMiddleware,
    [
      body('carousel_banner').trim().isLength({ min: 1 }).withMessage('Carousel banner is required'),
      body('caption').optional().trim().isLength({ max: 500 }).withMessage('Caption too long')
    ],
    cmsAdminController.manageCarousel.bind(cmsAdminController)
  );

  /**
   * @route PUT /api/cms/admin/carousels/:id
   * @desc Update carousel item
   * @access Admin only
   */
  router.put('/admin/carousels/:id', 
    adminAuthMiddleware,
    [
      body('carousel_banner').trim().isLength({ min: 1 }).withMessage('Carousel banner is required'),
      body('caption').optional().trim().isLength({ max: 500 }).withMessage('Caption too long')
    ],
    cmsAdminController.manageCarousel.bind(cmsAdminController)
  );

  /**
   * @route PUT /api/cms/admin/settings
   * @desc Update site settings
   * @access Admin only
   */
  router.put('/admin/settings', 
    adminAuthMiddleware,
    [
      body('site_contact').optional().trim().isLength({ max: 50 }),
      body('site_email').optional().isEmail().withMessage('Valid email required'),
      body('vat_rate').optional().isFloat({ min: 0, max: 100 }),
      body('credit_card_surcharge').optional().isFloat({ min: 0 }),
      body('paypal_surcharge').optional().isFloat({ min: 0 })
    ],
    cmsAdminController.updateSettings.bind(cmsAdminController)
  );

  /**
   * @route GET /api/cms/admin/search
   * @desc Global search across all CMS content
   * @access Admin only
   */
  router.get('/admin/search', 
    adminAuthMiddleware, 
    cmsAdminController.globalSearch.bind(cmsAdminController)
  );

  /**
   * @route GET /api/cms/admin/export
   * @desc Export CMS content for backup
   * @access Admin only
   */
  router.get('/admin/export', 
    adminAuthMiddleware, 
    cmsAdminController.exportContent.bind(cmsAdminController)
  );

  return router;
};