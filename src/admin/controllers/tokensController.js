const {
  listTokens,
  getTokenById,
  createToken,
  updateToken,
  deleteToken,
} = require('../services/tokensService');

class TokensController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listTokens(this.pool, {
        page: req.query.page,
        limit: req.query.limit,
        search: req.query.search || req.query.name_scr || '',
        sort: req.query.sort,
        order: req.query.order,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][TOKENS][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load tokens' });
    }
  }

  async getOne(req, res) {
    try {
      const row = await getTokenById(this.pool, req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Token not found' });
      }
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('[ADMIN][TOKENS][GET_ONE]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load token' });
    }
  }

  async create(req, res) {
    try {
      const result = await createToken(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: { id: result.id },
      });
    } catch (err) {
      console.error('[ADMIN][TOKENS][CREATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error adding token' });
    }
  }

  async update(req, res) {
    try {
      const result = await updateToken(this.pool, req.params.id, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][TOKENS][UPDATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error updating token' });
    }
  }

  async delete(req, res) {
    try {
      const result = await deleteToken(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][TOKENS][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error deleting token' });
    }
  }
}

module.exports = TokensController;
