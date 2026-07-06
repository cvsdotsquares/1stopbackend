const {
  refundBooking,
  deleteBooking,
  getDeleteMailTemplate,
} = require('../services/bookingRefundDeleteService');

class BookingsController {
  constructor(pool) {
    this.pool = pool;
  }

  parseBookingId(req) {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }
    return id;
  }

  getAdminId(req) {
    const adminId = req.session?.loggedinAdmin?.admin_id;
    const parsed = Number(adminId);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async refund(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found to refund',
        });
      }

      const result = await refundBooking(this.pool, bookingId, req);
      if (!result.ok) {
        const status = result.message === 'Booking not found to refund' ? 404 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({
        success: true,
        message: result.message,
        data: { courseEventId: result.courseEventId },
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][REFUND]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in refund for bookings',
      });
    }
  }

  async remove(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found to delete',
        });
      }

      const result = await deleteBooking(
        this.pool,
        bookingId,
        req.body || {},
        this.getAdminId(req),
        req
      );

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
        data: { courseEventId: result.courseEventId },
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error in deleting bookings',
      });
    }
  }

  async deleteMailTemplate(req, res) {
    try {
      const bookingId = this.parseBookingId(req);
      if (!bookingId) {
        return res.json({ success: false, status: 0, data: null });
      }

      const result = await getDeleteMailTemplate(this.pool, bookingId);
      if (!result.ok) {
        return res.json({ success: false, status: 0, data: null });
      }

      return res.json({
        success: true,
        status: 1,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][DELETE_TEMPLATE]', err.message);
      return res.status(500).json({
        success: false,
        status: 0,
        message: 'Unable to load delete mail template',
      });
    }
  }
}

module.exports = BookingsController;
