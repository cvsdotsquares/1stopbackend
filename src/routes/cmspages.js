const express = require('express');
const router = express.Router();
const CMSPagesController = require('../controllers/cmspages');

module.exports = (pool) => {
  const cmsPagesController = new CMSPagesController(pool);

  /**
   * @route GET /api/cmspages/preview/:pageId
   * @desc Token-gated CMS page preview by id (bypasses page_menus)
   * @access Public (requires valid preview token)
   */
  router.get(
    '/preview/:pageId',
    cmsPagesController.getPagePreview.bind(cmsPagesController)
  );

  /**
   * @route GET /api/cmspages/*
   * @desc Get page by nested slug path (e.g., /hello, /hello/world, /hello/world/say)
   * @access Public
   */
  router.get(/.*/, cmsPagesController.getPageByNestedSlug.bind(cmsPagesController));

  return router;
};
