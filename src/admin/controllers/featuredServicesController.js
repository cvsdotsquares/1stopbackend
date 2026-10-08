const {
  listFeaturedServices,
  getFeaturedServiceById,
  createFeaturedService,
  updateFeaturedService,
  deleteFeaturedService,
} = require('../services/featuredServicesService');

function mapFiles(req) {
  return (req.files || []).map((f) => ({
    fieldname: f.fieldname,
    buffer: f.buffer,
    originalname: f.originalname,
  }));
}

class FeaturedServicesController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const items = await listFeaturedServices(this.pool, req);
      return res.json({ success: true, data: { items } });
    } catch (err) {
      console.error('[ADMIN][FEATURED_SERVICES][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load featured services' });
    }
  }

  async getOne(req, res) {
    try {
      const row = await getFeaturedServiceById(this.pool, req.params.id, req);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Featured service not found' });
      }
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('[ADMIN][FEATURED_SERVICES][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load featured service' });
    }
  }

  async create(req, res) {
    try {
      const result = await createFeaturedService(this.pool, req.body || {}, mapFiles(req));
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: { id: result.id },
      });
    } catch (err) {
      console.error('[ADMIN][FEATURED_SERVICES][CREATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error adding featured service' });
    }
  }

  async update(req, res) {
    try {
      const result = await updateFeaturedService(
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
      console.error('[ADMIN][FEATURED_SERVICES][UPDATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error updating featured service' });
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteFeaturedService(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][FEATURED_SERVICES][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error deleting featured service' });
    }
  }
}

module.exports = FeaturedServicesController;
