const {
  listAutomatedEmails,
  getAutomatedEmailById,
  getCoursesList,
  createAutomatedEmail,
  updateAutomatedEmail,
  toggleAutomatedEmailStatus,
  deleteAutomatedEmail,
} = require('../services/automatedEmailsService');

class AutomatedEmailsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const page = req.query.page || 1;
      const limit = req.query.limit || 10;
      const search = req.query.search || '';
      const search_email = req.query.search_email || req.query.email_search || '';
      const course_id = req.query.course_id || '';

      const result = await listAutomatedEmails(this.pool, {
        page,
        limit,
        search,
        search_email,
        course_id,
      });
      return res.json({ success: true, data: result, ...result });
    } catch (err) {
      console.error('[ADMIN][AUTOMATED_EMAILS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load automated emails',
      });
    }
  }

  async getCourses(req, res) {
    try {
      const includeId = req.query.include_id || null;
      const courses = await getCoursesList(this.pool, includeId);
      return res.json({ success: true, data: courses });
    } catch (err) {
      console.error('[ADMIN][AUTOMATED_EMAILS][GET_COURSES]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load courses',
      });
    }
  }

  async getOne(req, res) {
    try {
      const item = await getAutomatedEmailById(this.pool, req.params.id);
      if (!item) {
        return res.status(404).json({
          success: false,
          message: 'Automated email not found',
        });
      }
      return res.json({ success: true, data: item });
    } catch (err) {
      console.error('[ADMIN][AUTOMATED_EMAILS][GET_ONE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load automated email',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createAutomatedEmail(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        id: result.id,
      });
    } catch (err) {
      console.error('[ADMIN][AUTOMATED_EMAILS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to create automated email',
      });
    }
  }

  async update(req, res) {
    try {
      const result = await updateAutomatedEmail(this.pool, req.params.id, req.body || {});
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][AUTOMATED_EMAILS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update automated email',
      });
    }
  }

  async toggleStatus(req, res) {
    try {
      const { status } = req.body || {};
      const result = await toggleAutomatedEmailStatus(this.pool, req.params.id, status !== undefined ? status : null);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({
        success: true,
        message: result.message,
        status: result.status,
      });
    } catch (err) {
      console.error('[ADMIN][AUTOMATED_EMAILS][TOGGLE_STATUS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to toggle status',
      });
    }
  }

  async delete(req, res) {
    try {
      const result = await deleteAutomatedEmail(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][AUTOMATED_EMAILS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to delete automated email',
      });
    }
  }
}

module.exports = AutomatedEmailsController;
