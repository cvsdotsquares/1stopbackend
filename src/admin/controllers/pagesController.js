const {
  listPages,
  getParentPageOptions,
  createPage,
  updatePageWeight,
  deletePage,
} = require('../services/pagesService');
const { createPreviewToken } = require('../../utils/pagePreviewToken');

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
      return res.status(500).json({
        success: false,
        message: 'Unable to load pages',
      });
    }
  }

  async parentOptions(req, res) {
    try {
      const options = await getParentPageOptions(this.pool);
      return res.json({ success: true, data: { options } });
    } catch (err) {
      console.error('[ADMIN][PAGES][PARENT_OPTIONS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load navigation levels',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createPage(this.pool, req.body || {}, req.file);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][PAGES][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in adding page',
      });
    }
  }

  async patch(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Page not found to update',
        });
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'weight')) {
        const result = await updatePageWeight(this.pool, id, req.body.weight);
        if (!result.ok) {
          return res.status(result.message.includes('not found') ? 404 : 400).json({
            success: false,
            message: result.message,
          });
        }
        return res.json({ success: true, message: result.message });
      }

      return res.status(400).json({
        success: false,
        message: 'No fields to update',
      });
    } catch (err) {
      console.error('[ADMIN][PAGES][PATCH]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update page',
      });
    }
  }

  async remove(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Page not found to delete',
        });
      }

      const result = await deletePage(this.pool, id);
      if (!result.ok) {
        return res.status(result.message.includes('not found') ? 404 : 400).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PAGES][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting page',
      });
    }
  }

  /**
   * Mint a short-lived signed preview token for the public front site.
   */
  async previewToken(req, res) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Page not found',
        });
      }

      const [rows] = await this.pool.query(
        'SELECT id FROM pages WHERE id = ? LIMIT 1',
        [id]
      );
      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: 'Page not found',
        });
      }

      const { token, expiresAt } = createPreviewToken(id);
      return res.json({
        success: true,
        data: {
          token,
          expires_at: expiresAt,
          preview_path: `/cms-preview/${id}?token=${encodeURIComponent(token)}`,
        },
      });
    } catch (err) {
      console.error('[ADMIN][PAGES][PREVIEW_TOKEN]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to create preview token',
      });
    }
  }
}

module.exports = PagesController;
