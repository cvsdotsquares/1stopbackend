const {
  listEmailTemplates,
  listEmailTemplateOptions,
  getEmailTemplateById,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
} = require('../services/emailTemplatesService');

class EmailTemplatesController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listEmailTemplates(this.pool, {
        page: req.query.page,
        limit: req.query.limit,
        search: req.query.search || '',
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][EMAIL_TEMPLATES][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load email templates' });
    }
  }

  async options(req, res) {
    try {
      const items = await listEmailTemplateOptions(this.pool);
      return res.json({ success: true, data: { items } });
    } catch (err) {
      console.error('[ADMIN][EMAIL_TEMPLATES][OPTIONS]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load email templates' });
    }
  }

  async getOne(req, res) {
    try {
      const row = await getEmailTemplateById(this.pool, req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Email template not found.' });
      }
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('[ADMIN][EMAIL_TEMPLATES][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load email template' });
    }
  }

  async create(req, res) {
    try {
      const result = await createEmailTemplate(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: { id: result.id },
      });
    } catch (err) {
      console.error('[ADMIN][EMAIL_TEMPLATES][CREATE]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to create email template' });
    }
  }

  async update(req, res) {
    try {
      const result = await updateEmailTemplate(this.pool, req.params.id, req.body || {});
      if (!result.ok) {
        const status = result.message === 'Email template not found.' ? 404 : 400;
        return res.status(status).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][EMAIL_TEMPLATES][UPDATE]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to update email template' });
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteEmailTemplate(this.pool, req.params.id);
      if (!result.ok) {
        const status = result.message === 'Email template not found.' ? 404 : 400;
        return res.status(status).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][EMAIL_TEMPLATES][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to delete email template' });
    }
  }
}

module.exports = EmailTemplatesController;
