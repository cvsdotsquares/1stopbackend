const { listAttendingCustomers } = require('../services/attendingCustomersService');

class AttendingCustomersController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listAttendingCustomers(this.pool, {
        page: req.query.page,
        name_scr: req.query.name_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][ATTENDING-CUSTOMERS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load attending customers',
      });
    }
  }
}

module.exports = AttendingCustomersController;
