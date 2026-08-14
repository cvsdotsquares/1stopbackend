const dl = require('../services/dlReturnsService');

class DlReturnsController {
  constructor(pool) {
    this.pool = pool;
  }

  fail(res, err, tag, fallback) {
    console.error(`[ADMIN][DL-RETURNS][${tag}]`, err.message);
    return res.status(500).json({ success: false, message: fallback });
  }

  async list(req, res) {
    try {
      const data = await dl.listDlReturns(this.pool, {
        page: req.query.page,
        searchterm: req.query,
      });
      return res.json({ success: true, data });
    } catch (err) {
      return this.fail(res, err, 'LIST', 'Unable to load DL196 returns');
    }
  }

  async options(req, res) {
    try {
      const data = await dl.getDlFormOptions(this.pool, req.query.location_id);
      return res.json({ success: true, data });
    } catch (err) {
      return this.fail(res, err, 'OPTIONS', 'Unable to load DL196 options');
    }
  }

  async create(req, res) {
    try {
      const result = await dl.createDlBook(this.pool, req.body || {}, req.session);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      return this.fail(res, err, 'CREATE', 'Error creating DL196 book');
    }
  }

  async getOne(req, res) {
    try {
      const data = await dl.getDlBook(this.pool, req.params.id);
      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'DL196 Book not found',
        });
      }
      return res.json({ success: true, data });
    } catch (err) {
      return this.fail(res, err, 'GET', 'Unable to load DL196 book');
    }
  }

  async remove(req, res) {
    try {
      const result = await dl.deleteDlBook(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'DELETE', 'Error deleting DL196 book');
    }
  }

  async status(req, res) {
    try {
      const result = await dl.updateBookStatus(
        this.pool,
        req.params.id,
        req.body?.status
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'STATUS', 'Unable to update status');
    }
  }

  async exportBook(req, res) {
    try {
      const result = await dl.exportDlBook(this.pool, req.params.id, {
        send: req.query.send || req.body?.send || 'admin',
        email: req.query.email || req.body?.email || '',
        resend: req.query.resend || req.body?.resend || 0,
      });
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: { filename: result.data.filename, sent_to: result.data.sent_to },
      });
    } catch (err) {
      return this.fail(res, err, 'EXPORT', 'Unable to export DL196 book');
    }
  }

  async getCert(req, res) {
    try {
      const data = await dl.getCertificate(this.pool, req.params.certId);
      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Certificate not found',
        });
      }
      return res.json({ success: true, data });
    } catch (err) {
      return this.fail(res, err, 'CERT', 'Unable to load certificate');
    }
  }

  async patchCert(req, res) {
    try {
      const result = await dl.updateCertificate(
        this.pool,
        req.params.certId,
        req.body || {},
        req.session
      );
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'CERT_PATCH', 'Unable to update certificate');
    }
  }

  async resetCert(req, res) {
    try {
      const result = await dl.resetCertificate(
        this.pool,
        req.params.certId,
        req.session
      );
      return res.json({ success: true, message: result.message });
    } catch (err) {
      return this.fail(res, err, 'CERT_RESET', 'Unable to reset certificate');
    }
  }
}

module.exports = DlReturnsController;
