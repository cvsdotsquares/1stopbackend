const {
  listDeletedBookings,
  purgeDeletedBooking,
  getDeletedBookingView,
} = require('../services/deletedBookingsService');

class DeletedBookingsController {
  constructor(pool) {
    this.pool = pool;
  }

  parseBookingId(req) {
    const id = Number(req.params.bookingId ?? req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }
    return id;
  }

  async list(req, res) {
    try {
      const data = await listDeletedBookings(this.pool, {
        page: req.query.page,
        name_scr: req.query.name_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][DELETED-BOOKINGS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load deleted bookings',
      });
    }
  }

  async purge(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found to delete',
        });
      }

      const result = await purgeDeletedBooking(this.pool, bookingId);
      if (!result.ok) {
        const status = result.message === 'Booking not found to delete' ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][DELETED-BOOKINGS][PURGE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting booking',
      });
    }
  }

  async view(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(404).json({
          success: false,
          message: 'Booking/Gift Voucher not found to view',
        });
      }

      const result = await getDeletedBookingView(this.pool, bookingId);
      if (!result.ok) {
        return res.status(404).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][DELETED-BOOKINGS][VIEW]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Booking/Gift Voucher not found to view',
      });
    }
  }
}

module.exports = DeletedBookingsController;
