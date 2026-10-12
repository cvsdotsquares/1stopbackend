const {
  listResultOptions,
  getResultOptionById,
  createResultOption,
  updateResultOption,
  deleteResultOption,
  reorderResultOptions,
} = require('../services/studentResultsService');

class StudentResultsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const search = req.query.search || '';
      const items = await listResultOptions(this.pool, { search });
      return res.json({ success: true, data: items, items });
    } catch (err) {
      console.error('[ADMIN][STUDENT_RESULTS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load student result options',
      });
    }
  }

  async reorder(req, res) {
    try {
      const { items } = req.body || {};
      const result = await reorderResultOptions(this.pool, items);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][STUDENT_RESULTS][REORDER]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to reorder result options',
      });
    }
  }

  async getOne(req, res) {
    try {
      const item = await getResultOptionById(this.pool, req.params.id);
      if (!item) {
        return res.status(404).json({
          success: false,
          message: 'Result option not found',
        });
      }
      return res.json({ success: true, data: item });
    } catch (err) {
      console.error('[ADMIN][STUDENT_RESULTS][GET_ONE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load result option',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createResultOption(this.pool, req.body || {});
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
      console.error('[ADMIN][STUDENT_RESULTS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to create result option',
      });
    }
  }

  async update(req, res) {
    try {
      const result = await updateResultOption(this.pool, req.params.id, req.body || {});
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
      console.error('[ADMIN][STUDENT_RESULTS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update result option',
      });
    }
  }

  async delete(req, res) {
    try {
      const result = await deleteResultOption(this.pool, req.params.id);
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
      console.error('[ADMIN][STUDENT_RESULTS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to delete result option',
      });
    }
  }
}

module.exports = StudentResultsController;
