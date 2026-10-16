const {
  listInstructors,
  getInstructorById,
  createInstructor,
  updateInstructor,
  toggleInstructorStatus,
  deleteInstructor,
} = require('../services/instructorsService');

class InstructorsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = req.query.limit !== undefined ? Number(req.query.limit) : 0;
      const search = req.query.search || '';
      const status = req.query.status !== undefined ? req.query.status : '';

      const result = await listInstructors(this.pool, { page, limit, search, status });
      return res.json({ success: true, data: result, ...result });
    } catch (err) {
      console.error('[ADMIN][INSTRUCTORS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load instructors',
      });
    }
  }

  async getOne(req, res) {
    try {
      const instructor = await getInstructorById(this.pool, req.params.id);
      if (!instructor) {
        return res.status(404).json({
          success: false,
          message: 'Instructor not found',
        });
      }
      return res.json({ success: true, data: instructor });
    } catch (err) {
      console.error('[ADMIN][INSTRUCTORS][GET_ONE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to retrieve instructor',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createInstructor(this.pool, req.body || {});
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
      console.error('[ADMIN][INSTRUCTORS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to create instructor',
      });
    }
  }

  async update(req, res) {
    try {
      const result = await updateInstructor(this.pool, req.params.id, req.body || {});
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({
        success: true,
        message: result.message,
        id: result.id,
      });
    } catch (err) {
      console.error('[ADMIN][INSTRUCTORS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update instructor',
      });
    }
  }

  async toggleStatus(req, res) {
    try {
      const statusOverride = req.body?.status !== undefined ? req.body.status : req.query.status;
      const result = await toggleInstructorStatus(this.pool, req.params.id, statusOverride);
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
      console.error('[ADMIN][INSTRUCTORS][TOGGLE_STATUS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to toggle instructor status',
      });
    }
  }

  async delete(req, res) {
    try {
      const result = await deleteInstructor(this.pool, req.params.id);
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
      console.error('[ADMIN][INSTRUCTORS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to delete instructor',
      });
    }
  }
}

module.exports = InstructorsController;
