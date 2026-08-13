const {
  listEmailLogs,
  deleteEmailLog,
  getEmailLogContent,
} = require('../services/emailLogsService');

class EmailLogsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listEmailLogs(this.pool, {
        page: req.query.page,
        searchterm: {
          name_scr: req.query.name_scr,
          status_scr: req.query.status_scr,
        },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][EMAIL_LOGS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load email logs',
      });
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteEmailLog(this.pool, req.params.id);
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][EMAIL_LOGS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting mail',
      });
    }
  }

  async content(req, res) {
    try {
      const id = req.params.id || req.body?.emailLogId || req.body?.id;
      const data = await getEmailLogContent(this.pool, id);
      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Email log not found',
        });
      }
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][EMAIL_LOGS][CONTENT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load email content',
      });
    }
  }
}

module.exports = EmailLogsController;
