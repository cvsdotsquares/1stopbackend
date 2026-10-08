const {
  listAccreditations,
  getAccreditationById,
  createAccreditation,
  updateAccreditation,
  deleteAccreditation,
} = require('../services/accreditationsService');

function mapFiles(req) {
  return (req.files || []).map((f) => ({
    fieldname: f.fieldname,
    buffer: f.buffer,
    originalname: f.originalname,
  }));
}

class AccreditationsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const items = await listAccreditations(this.pool, req);
      return res.json({ success: true, data: { items } });
    } catch (err) {
      console.error('[ADMIN][ACCREDITATIONS][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load accreditations' });
    }
  }

  async getOne(req, res) {
    try {
      const row = await getAccreditationById(this.pool, req.params.id, req);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Accreditation not found' });
      }
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('[ADMIN][ACCREDITATIONS][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load accreditation' });
    }
  }

  async create(req, res) {
    try {
      const result = await createAccreditation(this.pool, req.body || {}, mapFiles(req));
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: { id: result.id },
      });
    } catch (err) {
      console.error('[ADMIN][ACCREDITATIONS][CREATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error adding accreditation' });
    }
  }

  async update(req, res) {
    try {
      const result = await updateAccreditation(
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
      console.error('[ADMIN][ACCREDITATIONS][UPDATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error updating accreditation' });
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteAccreditation(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][ACCREDITATIONS][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error deleting accreditation' });
    }
  }
}

module.exports = AccreditationsController;
