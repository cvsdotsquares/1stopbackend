const {
  listCarousels,
  getCarouselById,
  createCarousel,
  updateCarousel,
  deleteCarousel,
} = require('../services/carouselsService');

function mapFiles(req) {
  return (req.files || []).map((f) => ({
    fieldname: f.fieldname,
    buffer: f.buffer,
    originalname: f.originalname,
  }));
}

class CarouselsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listCarousels(this.pool, {
        page: req.query.page,
        name_scr: req.query.name_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][CAROUSELS][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load carousels' });
    }
  }

  async getOne(req, res) {
    try {
      const row = await getCarouselById(this.pool, req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Carousel not found' });
      }
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('[ADMIN][CAROUSELS][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load carousel' });
    }
  }

  async create(req, res) {
    try {
      const result = await createCarousel(this.pool, req.body || {}, mapFiles(req));
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: { id: result.id },
      });
    } catch (err) {
      console.error('[ADMIN][CAROUSELS][CREATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error adding carousel' });
    }
  }

  async update(req, res) {
    try {
      const result = await updateCarousel(
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
      console.error('[ADMIN][CAROUSELS][UPDATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error updating carousel' });
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteCarousel(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][CAROUSELS][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error deleting carousel' });
    }
  }
}

module.exports = CarouselsController;
