const {
  listPages,
  createPage,
  deletePage,
  updatePageWeight,
  updatePageStatus,
  getPageById,
  getSectionCatalog,
  getCarouselPublicUrl,
} = require('../services/pagesService');
const { loadPageEditor } = require('../services/pageEditor/loadPageEditor');
const { loadNewPageEditor } = require('../services/pageEditor/loadNewPageEditor');
const { savePageCore } = require('../services/pageEditor/savePageCore');
const { savePageSections } = require('../services/pageEditor/savePageSections');
const {
  removePageSection,
  removeSectionItem,
  updateSectionSortOrder,
} = require('../services/pageSectionsRemoveService');
const { nestFormBody } = require('../utils/nestFormBody');
const { createCmsPreviewToken } = require('../../utils/cmsPreviewToken');

function resolveFrontSiteUrl() {
  for (const key of [
    'SITE_URL',
  ]) {
    const value = process.env[key];
    if (value && String(value).trim()) {
      return String(value).trim().replace(/\/+$/, '');
    }
  }
  return '';
}

class PagesController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listPages(this.pool, {
        page: req.query.page,
        searchterm: { name_scr: req.query.name_scr },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][PAGES][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load pages' });
    }
  }

  async getNewEditor(req, res) {
    try {
      const data = await loadNewPageEditor(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][PAGES][NEW_EDITOR]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load new page form' });
    }
  }

  async create(req, res) {
    const conn = await this.pool.getConnection();
    try {
      const flat = req.body || {};
      const body = nestFormBody(flat);
      const files = (req.files || []).map((f) => ({
        fieldname: f.fieldname,
        buffer: f.buffer,
        originalname: f.originalname,
        mimetype: f.mimetype,
      }));

      await conn.beginTransaction();

      const result = await createPage(conn, body);
      if (!result.ok) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: result.message,
          missingFields: result.missingFields,
        });
      }

      const id = result.id;
      body.id = id;
      body.page_id = id;

      const coreResult = await savePageCore(conn, id, body, files);
      if (!coreResult.ok) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: coreResult.message,
          missingFields: coreResult.missingFields,
        });
      }

      await savePageSections(conn, {
        pageId: id,
        dataType: 'page',
        body,
        files,
      });

      await conn.commit();

      return res.json({
        success: true,
        message: result.message || 'Page added successfully',
        data: { id },
      });
    } catch (err) {
      await conn.rollback();
      console.error('[ADMIN][PAGES][CREATE]', err);
      return res.status(500).json({ success: false, message: 'Error in adding page' });
    } finally {
      conn.release();
    }
  }

  async updateWeight(req, res) {
    try {
      const id = Number(req.params.id);
      const result = await updatePageWeight(this.pool, id, req.body?.weight ?? req.body?.pos);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('[ADMIN][PAGES][WEIGHT]', err.message);
      return res.status(500).json({ success: false, message: 'Error in change position' });
    }
  }

  async updateStatus(req, res) {
    try {
      const id = Number(req.params.id);
      const result = await updatePageStatus(this.pool, id, req.body?.status);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: { status: result.status },
      });
    } catch (err) {
      console.error('[ADMIN][PAGES][STATUS]', err.message);
      return res.status(500).json({ success: false, message: 'Error in change status' });
    }
  }

  async remove(req, res) {
    try {
      const id = Number(req.params.id);
      const result = await deletePage(this.pool, id);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PAGES][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error in deleting page' });
    }
  }

  async getEditor(req, res) {
    try {
      const id = Number(req.params.id);
      const data = await loadPageEditor(this.pool, id);
      if (!data) {
        return res.status(404).json({ success: false, message: 'Page not found to edit' });
      }

      const page = data.page;
      if (page?.carousel_static_image) {
        page.carousel_static_image_url = getCarouselPublicUrl(
          req,
          page.carousel_static_image
        );
      }

      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][PAGES][EDITOR_GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load page editor' });
    }
  }

  async saveEditor(req, res) {
    const conn = await this.pool.getConnection();
    try {
      const id = Number(req.params.id);
      const flat = req.body || {};
      const body = nestFormBody(flat);
      body.id = body.id || id;
      body.page_id = body.page_id || id;

      const files = (req.files || []).map((f) => ({
        fieldname: f.fieldname,
        buffer: f.buffer,
        originalname: f.originalname,
        mimetype: f.mimetype,
      }));

      await conn.beginTransaction();

      const coreResult = await savePageCore(conn, id, body, files);
      if (!coreResult.ok) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: coreResult.message,
          missingFields: coreResult.missingFields,
        });
      }

      await savePageSections(conn, {
        pageId: id,
        dataType: 'page',
        body,
        files,
      });

      await conn.commit();

      return res.json({
        success: true,
        message: 'Page edited successfully',
        data: { id },
      });
    } catch (err) {
      await conn.rollback();
      console.error('[ADMIN][PAGES][EDITOR_SAVE]', err);
      return res.status(500).json({ success: false, message: 'Error in updating page' });
    } finally {
      conn.release();
    }
  }

  async sectionCatalog(req, res) {
    try {
      const items = await getSectionCatalog(this.pool);
      return res.json({ success: true, data: { items } });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load sections' });
    }
  }

  async removeSection(req, res) {
    try {
      const result = await removePageSection(this.pool, {
        pageId: req.body.page_id,
        pageType: req.body.pageType || 'page',
        slider_type: req.body.slider_type,
        section_id: req.body.section_id,
      });
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('[ADMIN][PAGES][REMOVE_SECTION]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to remove section' });
    }
  }

  async removeItem(req, res) {
    try {
      const result = await removeSectionItem(this.pool, {
        sectiontype: req.body.sectiontype,
        section_id: req.body.section_id,
        itemid: req.body.itemid,
      });
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to remove item' });
    }
  }

  async sortSection(req, res) {
    try {
      const result = await updateSectionSortOrder(this.pool, {
        page_id: req.body.page_id,
        section_type: req.body.section_type,
        sort_order: req.body.sort_order,
        sectionId: req.body.sectionId,
        page_type: req.body.page_type || 'page',
      });
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ status: 'success', message: result.message });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: 'Failed to update sort order' });
    }
  }

  async previewUrl(req, res) {
    try {
      const id = Number(req.params.id);
      const page = await getPageById(this.pool, id);
      if (!page) {
        return res.status(404).json({ success: false, message: 'Page not found' });
      }
      const token = createCmsPreviewToken(id);
      if (!token) {
        return res.status(500).json({
          success: false,
          message: 'Preview signing is not configured (CMS_PREVIEW_KEY or SESSION_SECRET)',
        });
      }
      const front = resolveFrontSiteUrl();
      if (!front) {
        return res.status(500).json({
          success: false,
          message:
            'Set FRONT_SITE_URL on the API server to the user portal origin (e.g. http://localhost:3002)',
        });
      }
      const url = `${front}/cms-preview/${id}?${new URLSearchParams({ token }).toString()}`;
      return res.json({ success: true, data: { url, pageId: id } });
    } catch (err) {
      console.error('[ADMIN][PAGES][PREVIEW_URL]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to build preview URL' });
    }
  }
}

module.exports = PagesController;
