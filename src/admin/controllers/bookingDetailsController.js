const {
  loadBookingDetails,
  lockBooking,
  endCounterLock,
  abandonAdminBookingSession,
  removeProcessCurLock,
  setEventFreeze,
} = require('../services/bookingDetailsService');

class BookingDetailsController {
  constructor(pool) {
    this.pool = pool;
  }

  getAdminId(req) {
    const admin = req.session?.loggedinAdmin;
    return admin?.admin_id ?? admin?.id ?? null;
  }

  async getDetails(req, res) {
    try {
      const evId = Number(req.params.evId);
      if (!Number.isFinite(evId) || evId <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Invalid course, Try again',
        });
      }

      const result = await loadBookingDetails(
        this.pool,
        req,
        evId,
        req.query.page
      );

      if (!result.ok) {
        return res.status(404).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][DETAILS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load booking details',
      });
    }
  }

  async postLock(req, res) {
    try {
      const evId = Number(req.params.evId);
      const spaceRequired = Number(req.body?.space_required);

      if (!Number.isFinite(evId) || evId <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Invalid course, Try again',
        });
      }

      const adminId = this.getAdminId(req);
      const result = await lockBooking(
        this.pool,
        req,
        evId,
        spaceRequired,
        adminId
      );

      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
          redirect: result.redirect,
        });
      }

      return res.json({
        success: true,
        redirect: result.redirect,
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][LOCK]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to lock booking spaces',
      });
    }
  }

  async postLockEnd(req, res) {
    try {
      const result = await endCounterLock(this.pool, req);
      return res.json({
        success: result.ok,
        message: result.message,
        redirect: result.redirect,
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][LOCK-END]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to end booking session',
      });
    }
  }

  async postAbandonSession(req, res) {
    try {
      const hadSession = Boolean(
        req.session?.adminBooking?.lock_session?.id ||
          req.session?.adminBooking?.lock_countdown ||
          req.session?.worldPaymentBookings?.length
      );
      const result = await abandonAdminBookingSession(this.pool, req);
      return res.json({
        success: result.ok,
        abandoned: hadSession,
        redirect: result.redirect,
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][SESSION-ABANDON]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to cancel booking session',
      });
    }
  }

  async deleteProcessBooking(req, res) {
    try {
      const lockId = Number(
        req.body?.deleteProcessBookingId ?? req.body?.lockId
      );

      if (!Number.isFinite(lockId) || lockId <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid lock booking',
        });
      }

      await removeProcessCurLock(this.pool, lockId);

      return res.json({
        success: true,
        redirect: '/admin/dashboard',
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][DELETE-PROCESS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to delete in-process booking',
      });
    }
  }

  async postFreeze(req, res) {
    try {
      const evId = Number(req.params.evId);
      const freeze = Number(req.body?.freeze);

      if (!Number.isFinite(evId) || evId <= 0) {
        return res.status(404).json({
          success: false,
          message: 'Invalid course, Try again',
        });
      }

      const result = await setEventFreeze(
        this.pool,
        evId,
        req.body?.ceDates,
        freeze
      );

      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][FREEZE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to update freeze status',
      });
    }
  }
}

module.exports = BookingDetailsController;
