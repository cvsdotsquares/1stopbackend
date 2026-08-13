const {
  listTransactions,
  deleteTransaction,
} = require('../services/transactionsService');

class TransactionsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listTransactions(this.pool, {
        page: req.query.page,
        searchterm: {
          name_scr: req.query.name_scr,
          status_scr: req.query.status_scr,
          from_scr: req.query.from_scr,
          to_scr: req.query.to_scr,
        },
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][TRANSACTIONS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load transactions',
      });
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteTransaction(this.pool, req.params.id);
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][TRANSACTIONS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting transaction',
      });
    }
  }
}

module.exports = TransactionsController;
