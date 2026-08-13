const {
  listPromos,
  getPromoById,
  createPromo,
  updatePromo,
  updatePromoStatus,
  softDeletePromo,
  getPromoFormOptions,
} = require('../services/promosService');

class PromosController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listPromos(this.pool, {
        page: req.query.page,
        searchterm: { name_scr: req.query.name_scr },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][PROMOS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load promos',
      });
    }
  }

  async options(req, res) {
    try {
      const data = await getPromoFormOptions(this.pool);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][PROMOS][OPTIONS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load promo options',
      });
    }
  }

  async getOne(req, res) {
    try {
      const promo = await getPromoById(this.pool, req.params.id);
      if (!promo || promo.isDeleted === 1) {
        return res.status(404).json({
          success: false,
          message: 'Promo code not found to edit',
        });
      }
      const formOptions = await getPromoFormOptions(this.pool);
      return res.json({
        success: true,
        data: { promo, formOptions },
      });
    } catch (err) {
      console.error('[ADMIN][PROMOS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load promo',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createPromo(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][PROMOS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in adding promo code',
      });
    }
  }

  async update(req, res) {
    try {
      const result = await updatePromo(this.pool, req.params.id, req.body || {});
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PROMOS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in updating promo code',
      });
    }
  }

  async updateStatus(req, res) {
    try {
      const result = await updatePromoStatus(
        this.pool,
        req.params.id,
        req.body?.status
      );
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PROMOS][STATUS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in change status',
      });
    }
  }

  async remove(req, res) {
    try {
      const result = await softDeletePromo(this.pool, req.params.id);
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][PROMOS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting promo code',
      });
    }
  }
}

module.exports = PromosController;
