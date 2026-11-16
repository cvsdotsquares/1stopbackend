const {
  shareCourseDatesCsv,
  searchAttendeesForMailshot,
  searchAttendeesForMailshotBatch,
  listStripePaymentLinks,
} = require('../services/csvExportService');

class CsvExportController {
  constructor(pool) {
    this.pool = pool;
  }

  async paymentLinks(req, res) {
    try {
      const items = await listStripePaymentLinks();
      return res.json({ success: true, data: { items } });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('[ADMIN][CSV_EXPORT][PAYMENT_LINKS]', err.message);
      }
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load payment links',
      });
    }
  }

  async attendeeSearch(req, res) {
    try {
      const body = req.body || {};
      const queries = Array.isArray(body.queries) ? body.queries : null;
      const items = queries
        ? await searchAttendeesForMailshotBatch(this.pool, queries)
        : await searchAttendeesForMailshot(this.pool, body);
      return res.json({ success: true, data: { items } });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('[ADMIN][CSV_EXPORT][ATTENDEE_SEARCH]', err.message);
      }
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load attendees',
      });
    }
  }

  async share(req, res) {
    try {
      const admin = req.session?.admin || {};
      const emailBy =
        admin.admin_username || admin.username || admin.admin_email || 'admin';
      const data = await shareCourseDatesCsv(this.pool, req.body || {}, emailBy);
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('[ADMIN][CSV_EXPORT][SHARE]', err.message);
      }
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to share course dates',
      });
    }
  }
}

module.exports = CsvExportController;
