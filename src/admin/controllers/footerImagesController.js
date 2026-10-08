const {
  listFooterImages,
  getFooterImageById,
  createFooterImage,
  updateFooterImage,
  deleteFooterImage,
} = require('../services/footerImagesService');

function mapFiles(req) {
  return (req.files || []).map((f) => ({
    fieldname: f.fieldname,
    buffer: f.buffer,
    originalname: f.originalname,
  }));
}

class FooterImagesController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listFooterImages(this.pool, {
        page: req.query.page,
        name_scr: req.query.name_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][FOOTER_IMAGES][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load footer images' });
    }
  }

  async getOne(req, res) {
    try {
      const row = await getFooterImageById(this.pool, req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Footer image not found' });
      }
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('[ADMIN][FOOTER_IMAGES][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load footer image' });
    }
  }

  async create(req, res) {
    try {
      const result = await createFooterImage(this.pool, req.body || {}, mapFiles(req));
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: { id: result.id },
      });
    } catch (err) {
      console.error('[ADMIN][FOOTER_IMAGES][CREATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error adding footer image' });
    }
  }

  async update(req, res) {
    try {
      const result = await updateFooterImage(
        this.pool,
        req.params.id,
        req.body || {},
        mapFiles(req)
      );
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][FOOTER_IMAGES][UPDATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error updating footer image' });
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteFooterImage(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][FOOTER_IMAGES][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error deleting footer image' });
    }
  }
}

module.exports = FooterImagesController;
