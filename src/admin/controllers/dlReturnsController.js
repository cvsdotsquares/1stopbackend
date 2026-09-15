const dlReturnsService = require('../services/dlReturnsService');

class DlReturnsController {
  constructor(pool) {
    this.pool = pool;
  }

  flashMessage(err, fallback) {
    if (err.code === 'VALIDATION' || err.code === 'DUPLICATE' || err.code === 'NOT_FOUND') {
      return err.message;
    }
    return fallback;
  }

  async list(req, res) {
    try {
      const data = await dlReturnsService.listDlReturns(this.pool, req.query);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][DL][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load DL196 returns' });
    }
  }

  async options(req, res) {
    try {
      const data = await dlReturnsService.getDlFormOptions(
        this.pool,
        req.query.location_id
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load DL196 options' });
    }
  }

  async getOne(req, res) {
    try {
      const data = await dlReturnsService.getDlReturnBook(this.pool, req.params.id);
      if (!data) {
        return res.status(404).json({ success: false, message: 'DL196 book not found' });
      }
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load DL196 book' });
    }
  }

  async create(req, res) {
    try {
      const data = await dlReturnsService.createDlReturnBook(
        this.pool,
        req.body,
        req.session
      );
      return res.json({
        success: true,
        data,
        message: 'DL196 Return Book created successfully',
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to create DL196 book'),
      });
    }
  }

  async remove(req, res) {
    try {
      await dlReturnsService.deleteDlReturnBook(this.pool, req.params.id);
      return res.json({ success: true, message: 'DL196 Book deleted successfully' });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Error in deleting DL196 Book'),
      });
    }
  }

  async updateCertificateStatus(req, res) {
    try {
      const status = req.body.status;
      const bookId = req.body.loc_id ?? req.params.id;
      const data = await dlReturnsService.updateDlCertificateStatus(
        this.pool,
        bookId,
        status
      );
      return res.json({ success: true, ...data });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to update status'),
      });
    }
  }

  async getCertificate(req, res) {
    try {
      const certificate = await dlReturnsService.getDlCertificate(
        this.pool,
        req.params.id
      );
      if (!certificate) {
        return res.status(404).json({ success: false, message: 'Certificate not found' });
      }
      return res.json({ success: true, data: { certificate } });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load certificate' });
    }
  }

  async updateCertificate(req, res) {
    try {
      const certificate = await dlReturnsService.updateDlCertificate(
        this.pool,
        req.params.id,
        req.body,
        req.session
      );
      return res.json({ success: true, data: { certificate } });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to update certificate'),
      });
    }
  }
}

module.exports = DlReturnsController;
