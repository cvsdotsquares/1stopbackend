const dlReturnsService = require('../services/dlReturnsService');

class DlReturnsController {
  constructor(pool) {
    this.pool = pool;
  }

  flashMessage(err, fallback) {
    if (
      err.code === 'VALIDATION' ||
      err.code === 'DUPLICATE' ||
      err.code === 'NOT_FOUND' ||
      err.code === 'BOOK_LOCKED' ||
      err.code === 'MAIL_FAILED' ||
      err.code === 'LICENCE_VALIDATION'
    ) {
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

  async booksByLocation(req, res) {
    try {
      const items = await dlReturnsService.listDlBooksByLocation(
        this.pool,
        req.query.location_id
      );
      return res.json({ success: true, data: { items } });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load books' });
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
      console.error('[ADMIN][DL][CREATE]', err.message, err.stack);
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

  async toggleLock(req, res) {
    try {
      const data = await dlReturnsService.toggleDlReturnLock(this.pool, req.params.id);
      return res.json({
        success: true,
        data,
        message: 'Lock status has been successfully changes',
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to toggle lock'),
      });
    }
  }

  async exportBook(req, res) {
    try {
      const data = await dlReturnsService.exportDlReturnBook(this.pool, req.params.id, {
        send: req.body.send ?? req.query.send,
        resend: req.body.resend ?? req.query.resend,
        email: req.body.email ?? req.query.email,
      });
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to export DL196 book'),
      });
    }
  }

  async updateBook(req, res) {
    try {
      const data = await dlReturnsService.updateDlReturnBookDetails(
        this.pool,
        req.params.id,
        req.body
      );
      return res.json({
        success: true,
        data,
        message: 'DL196 Return Book updated successfully',
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to update book'),
      });
    }
  }

  async resetCertificate(req, res) {
    try {
      const data = await dlReturnsService.resetDlReturnCertificate(
        this.pool,
        req.params.id,
        req.session
      );
      return res.json({
        success: true,
        data,
        message: 'Certificate deleted successfully',
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Error in deleting Certificate'),
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

  async getCertificateEditContext(req, res) {
    try {
      const data = await dlReturnsService.getCertificateEditContext(
        this.pool,
        req.params.id
      );
      if (!data) {
        return res.status(404).json({ success: false, message: 'Certificate not found' });
      }
      return res.json({ success: true, data });
    } catch (err) {
      if (err.code === 'BOOK_LOCKED') {
        return res.status(403).json({
          success: false,
          message: err.message,
          book_id: err.book_id,
        });
      }
      return res.status(500).json({
        success: false,
        message: this.flashMessage(err, 'Unable to load certificate editor'),
      });
    }
  }

  async getCertificateAttendees(req, res) {
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

  async getBookAttendeesForDate(req, res) {
    try {
      const data = await dlReturnsService.getAttendeesForBookDate(
        this.pool,
        req.params.id,
        req.query.completion_date
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load attendees' });
    }
  }

  async getBookCourseStartTime(req, res) {
    try {
      const data = await dlReturnsService.getCourseEventStartTimeForBook(
        this.pool,
        req.params.id,
        req.query.sel_date ?? req.query.completion_date,
        req.query.attendee
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load course start time' });
    }
  }

  async checkBookNo(req, res) {
    try {
      const data = await dlReturnsService.checkBookNoAvailability(
        this.pool,
        req.query.book_no,
        req.query.mode || 'add',
        req.query.id
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: this.flashMessage(err, 'Unable to check book number'),
      });
    }
  }

  async getCourseStartTime(req, res) {
    try {
      const data = await dlReturnsService.getCourseEventStartTime(
        this.pool,
        req.params.id,
        req.query.sel_date ?? req.query.completion_date,
        req.query.attendee
      );
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Unable to load course start time' });
    }
  }

  async lookupCertificateByNumber(req, res) {
    try {
      const certificateNo =
        req.query.certificate_no ?? req.query.certificate_val ?? req.body?.certificate_val;
      const data = await dlReturnsService.lookupCertificateByNumber(this.pool, certificateNo);
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({
        success: false,
        message: this.flashMessage(err, 'Certificate lookup failed'),
      });
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
      return res.json({ success: true, data: { certificate }, message: 'DL Book updated' });
    } catch (err) {
      const status = err.code === 'BOOK_LOCKED' ? 403 : 400;
      return res.status(status).json({
        success: false,
        message: this.flashMessage(err, 'Unable to update certificate'),
        book_id: err.book_id,
      });
    }
  }

  async multiEdit(req, res) {
    try {
      const data = await dlReturnsService.bulkMultiEditCertificates(
        this.pool,
        req.params.id,
        req.body,
        req.session
      );
      return res.json({ success: true, data, message: 'DL Book updated' });
    } catch (err) {
      const status = err.code === 'BOOK_LOCKED' ? 403 : 400;
      return res.status(status).json({
        success: false,
        message: this.flashMessage(err, 'Unable to multi edit certificates'),
        book_id: err.book_id,
      });
    }
  }
}

module.exports = DlReturnsController;
