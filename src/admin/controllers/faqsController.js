const {
  listFaqs,
  getFaqById,
  getFormOptions,
  createFaq,
  updateFaq,
  softDeleteFaq,
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  softDeleteCategory,
} = require('../services/faqsService');

function parseId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

class FaqsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listFaqs(this.pool, {
        category_id: req.query.category_id,
        status: req.query.status,
        q: req.query.q,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][FAQS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load FAQs',
      });
    }
  }

  async formOptions(req, res) {
    try {
      const data = await getFormOptions(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][FAQS][OPTIONS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load form options',
      });
    }
  }

  async getById(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'FAQ not found' });
      }
      const faq = await getFaqById(this.pool, id);
      if (!faq) {
        return res.status(404).json({ success: false, message: 'FAQ not found' });
      }
      return res.json({ success: true, data: faq });
    } catch (err) {
      console.error('[ADMIN][FAQS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load FAQ',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createFaq(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][FAQS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error adding FAQ',
      });
    }
  }

  async update(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'FAQ not found' });
      }
      const result = await updateFaq(this.pool, id, req.body || {});
      if (!result.ok) {
        return res
          .status(result.message.includes('not found') ? 404 : 400)
          .json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][FAQS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error updating FAQ',
      });
    }
  }

  async remove(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res.status(404).json({ success: false, message: 'FAQ not found' });
      }
      const result = await softDeleteFaq(this.pool, id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][FAQS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error deleting FAQ',
      });
    }
  }

  async listCategories(req, res) {
    try {
      const includeInactive =
        String(req.query.include_inactive || '') === '1' ||
        String(req.query.include_inactive || '').toLowerCase() === 'true';
      const data = await listCategories(this.pool, { includeInactive });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][FAQ_CATEGORIES][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load FAQ categories',
      });
    }
  }

  async getCategoryById(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res
          .status(404)
          .json({ success: false, message: 'Category not found' });
      }
      const category = await getCategoryById(this.pool, id);
      if (!category) {
        return res
          .status(404)
          .json({ success: false, message: 'Category not found' });
      }
      return res.json({ success: true, data: category });
    } catch (err) {
      console.error('[ADMIN][FAQ_CATEGORIES][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load FAQ category',
      });
    }
  }

  async createCategory(req, res) {
    try {
      const result = await createCategory(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][FAQ_CATEGORIES][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error adding FAQ category',
      });
    }
  }

  async updateCategory(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res
          .status(404)
          .json({ success: false, message: 'Category not found' });
      }
      const result = await updateCategory(this.pool, id, req.body || {});
      if (!result.ok) {
        return res
          .status(result.message.includes('not found') ? 404 : 400)
          .json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][FAQ_CATEGORIES][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error updating FAQ category',
      });
    }
  }

  async removeCategory(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res
          .status(404)
          .json({ success: false, message: 'Category not found' });
      }
      const result = await softDeleteCategory(this.pool, id);
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][FAQ_CATEGORIES][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error deleting FAQ category',
      });
    }
  }
}

module.exports = FaqsController;
