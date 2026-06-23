const {
  getCbtCertificatesAvailability,
  getVehicleHeaderStatus,
  buildMonthPagination,
  syncCalendarSession,
} = require('../services/headerService');

class HeaderController {
  constructor(pool) {
    this.pool = pool;
  }

  async getHeader(req, res) {
    try {
      syncCalendarSession(req);

      const monthCal = req.session.monthCal;
      const yearCal = req.session.yearCal;

      const [cbtCertificates, vehicleStatus] = await Promise.all([
        getCbtCertificatesAvailability(this.pool),
        getVehicleHeaderStatus(this.pool),
      ]);

      const monthPagination = buildMonthPagination(monthCal, yearCal);

      const crs_scr =
        req.query.crs_scr != null && String(req.query.crs_scr).trim() !== ''
          ? String(req.query.crs_scr)
          : '';
      const loc_scr =
        req.query.loc_scr != null && String(req.query.loc_scr).trim() !== ''
          ? String(req.query.loc_scr)
          : '';

      return res.json({
        success: true,
        data: {
          cbtCertificates,
          vehicleStatus,
          monthPagination,
          filters: { crs_scr, loc_scr },
        },
      });
    } catch (err) {
      console.error('[ADMIN][HEADER]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load header data',
      });
    }
  }
}

module.exports = HeaderController;
