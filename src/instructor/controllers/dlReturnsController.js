const dlReturnsService = require('../../admin/services/dlReturnsService');

class InstructorDlReturnsController {
  constructor(pool) {
    this.pool = pool;
  }

  flashMessage(err, fallback) {
    if (
      err.code === 'VALIDATION' ||
      err.code === 'DUPLICATE' ||
      err.code === 'NOT_FOUND' ||
      err.code === 'BOOK_LOCKED' ||
      err.code === 'LICENCE_VALIDATION'
    ) {
      return err.message;
    }
    return fallback;
  }

  /**
   * Legacy instructor/dl_returns.php → getInstructorDLReturns:
   * unlocked On-Site books only, lowest book number first.
   */
  async list(req, res) {
    try {
      const query = {
        ...req.query,
        lock_scr: '0',
        certificate_src: 'On-Site',
        sort: 'book_asc',
      };
      const data = await dlReturnsService.listDlReturns(this.pool, query);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[INSTRUCTOR][DL][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load DL196 returns' });
    }
  }

  async options(req, res) {
    try {
      const data = await dlReturnsService.getDlFormOptions(
        this.pool,
        req.query.location_id || req.session?.location
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

  async getCertificateEditContext(req, res) {
    try {
      const data = await dlReturnsService.getCertificateEditContext(
        this.pool,
        req.params.id
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(404).json({
        success: false,
        message: this.flashMessage(err, 'Certificate not found'),
      });
    }
  }

  async getAttendees(req, res) {
    try {
      const data = await dlReturnsService.getCertificateAttendees(
        this.pool,
        req.params.id,
        req.query.completion_date
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load attendees' });
    }
  }

  async getCourseStartTime(req, res) {
    try {
      const data = await dlReturnsService.getCourseEventStartTimeForBook(
        this.pool,
        req.params.bookId,
        req.query.sel_date,
        req.query.attendee
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load course start time' });
    }
  }

  async updateCertificate(req, res) {
    try {
      const cert = await dlReturnsService.updateDlCertificate(
        this.pool,
        req.params.id,
        req.body,
        req.session
      );
      return res.json({
        success: true,
        data: { certificate: cert },
        message: 'Certificate updated successfully',
      });
    } catch (err) {
      console.error('[INSTRUCTOR][DL][UPDATE_CERT]', err.message);
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to update certificate'),
      });
    }
  }

  async resetCertificate(req, res) {
    try {
      const data = await dlReturnsService.resetDlReturnCertificate(
        this.pool,
        req.params.id,
        {
          admin_fristname: 'Office',
          admin_lastname: '',
        }
      );
      return res.json({
        success: true,
        data,
        message: 'Certificate deleted successfully',
      });
    } catch (err) {
      console.error('[INSTRUCTOR][DL][RESET_CERT]', err.message);
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Error in deleting Certificate'),
      });
    }
  }
}

module.exports = InstructorDlReturnsController;
