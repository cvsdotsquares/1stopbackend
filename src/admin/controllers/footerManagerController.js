const svc = require('../services/footerManagerService');

class FooterManagerController {
  constructor(pool) {
    this.pool = pool;
  }

  async getState(req, res) {
    try {
      const data = await svc.getFooterManagerState(this.pool);
      return res.json({ success: true, data });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Unable to load footer manager' });
    }
  }

  async updateContent(req, res) {
    const result = await svc.updateFooterContent(this.pool, req.body || {});
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  }

  async saveMenuSection(req, res) {
    const result = await svc.saveMenuSection(this.pool, req.body || {});
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  }

  async deleteMenuSection(req, res) {
    const result = await svc.deleteMenuSection(this.pool, req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  }

  async saveLink(req, res) {
    const result = await svc.saveFooterLink(this.pool, req.body || {});
    if (!result.ok) return res.status(400).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  }

  async deleteLink(req, res) {
    const result = await svc.deleteFooterLink(this.pool, req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  }
}

module.exports = FooterManagerController;
