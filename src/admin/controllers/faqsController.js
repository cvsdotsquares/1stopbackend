const {
  listFaqsAdmin,
  getFaqCategories,
  getFaqCategoryById,
  createFaqCategory,
  updateFaqCategory,
  softDeleteFaqCategory,
  getFaqById,
  createFaq,
  updateFaq,
  softDeleteFaq,
} = require('../services/faqsService');

class FaqsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listFaqsAdmin(this.pool, {
        page: req.query.page,
        name_scr: req.query.name_scr,
        cat_scr: req.query.cat_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][FAQS][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load faqs' });
    }
  }

  async listCategories(req, res) {
    try {
      const categories = await getFaqCategories(this.pool, false);
      return res.json({ success: true, data: { categories } });
    } catch (err) {
      console.error('[ADMIN][FAQS][CATEGORIES]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load categories' });
    }
  }

  async getCategory(req, res) {
    try {
      const row = await getFaqCategoryById(this.pool, req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Category not found' });
      }
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('[ADMIN][FAQS][GET_CATEGORY]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load category' });
    }
  }

  async createCategory(req, res) {
    try {
      const result = await createFaqCategory(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({ success: true, message: result.message, data: { id: result.id } });
    } catch (err) {
      console.error('[ADMIN][FAQS][CREATE_CATEGORY]', err.message);
      return res.status(500).json({ success: false, message: 'Error in adding category name' });
    }
  }

  async updateCategory(req, res) {
    try {
      const result = await updateFaqCategory(this.pool, req.params.id, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][FAQS][UPDATE_CATEGORY]', err.message);
      return res.status(500).json({ success: false, message: 'Error editing category' });
    }
  }

  async deleteCategory(req, res) {
    try {
      const result = await softDeleteFaqCategory(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][FAQS][DELETE_CATEGORY]', err.message);
      return res.status(500).json({ success: false, message: 'Error in deleting record' });
    }
  }

  async getOne(req, res) {
    try {
      const row = await getFaqById(this.pool, req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Faq not found' });
      }
      const categories = await getFaqCategories(this.pool, false);
      return res.json({ success: true, data: { faq: row, categories } });
    } catch (err) {
      console.error('[ADMIN][FAQS][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load faq' });
    }
  }

  async create(req, res) {
    try {
      const result = await createFaq(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({ success: true, message: result.message, data: { id: result.id } });
    } catch (err) {
      console.error('[ADMIN][FAQS][CREATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error in adding Faq' });
    }
  }

  async update(req, res) {
    try {
      const result = await updateFaq(this.pool, req.params.id, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][FAQS][UPDATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error in editing Faq' });
    }
  }

  async remove(req, res) {
    try {
      const result = await softDeleteFaq(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][FAQS][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error in deleting record' });
    }
  }
}

module.exports = FaqsController;
