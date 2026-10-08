const express = require('express');
const router = express.Router();
const CMSPagesController = require('../controllers/cmspages');

module.exports = (pool) => {
  const cmsPagesController = new CMSPagesController(pool);

  /**
   * @route GET /api/cmspages/*
   * @desc Get page by nested slug path (e.g., /hello, /hello/world, /hello/world/say)
   * @query preview=1 — draft/unpublished paths (requires X-CMS-Preview-Key when CMS_PREVIEW_KEY is set)
   * @access Public (preview gated)
   */
  router.get(
    '/preview/:pageId',
    cmsPagesController.getPagePreviewById.bind(cmsPagesController)
  );
  router.get(/.*/, cmsPagesController.getPageByNestedSlug.bind(cmsPagesController));

  return router;
};