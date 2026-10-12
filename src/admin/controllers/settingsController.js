const {
  getAdminSettings,
  updateAdminSettings,
} = require('../services/settingsService');

function mapFiles(req) {
  return (req.files || []).map((f) => ({
    fieldname: f.fieldname,
    buffer: f.buffer,
    originalname: f.originalname,
  }));
}

class SettingsController {
  constructor(pool) {
    this.pool = pool;
  }

  async get(req, res) {
    try {
      const data = await getAdminSettings(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][SETTINGS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load settings',
      });
    }
  }

  async update(req, res) {
    try {
      const files = mapFiles(req);
      const result = await updateAdminSettings(this.pool, req.body || {}, files, req);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][SETTINGS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error updating settings',
      });
    }
  }
}

module.exports = SettingsController;
