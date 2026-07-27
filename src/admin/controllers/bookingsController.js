const {
  getEventBookingPage,
  lockEventSeats,
  removeProcessLock,
  setEventFreeze,
} = require('../services/eventBookingService');
const {
  getAddBookingWizard,
  getContactCard,
  searchExistingCustomers,
  submitAddBookingAttendees,
  cancelAddBookingWizard,
} = require('../services/addBookingWizardService');
const {
  getBookingWorldpayPayload,
  completeBookingWorldpayNotify,
  cancelBookingWorldpay,
  handleBookingWorldpayBrowserComplete,
  getBookingConfirmationDetails,
} = require('../services/bookingWorldpayService');
const { getAdminFrontendBase } = require('../services/motoPaymentService');

class BookingsController {
  constructor(pool) {
    this.pool = pool;
  }

  getAdminId(req) {
    const loggedIn = req.session?.loggedinAdmin;
    const adminId =
      loggedIn?.admin_id || loggedIn?.id || req.session?.admin || 0;
    return Number(adminId) || 0;
  }

  async getEventPage(req, res) {
    try {
      const evId = Number(req.params.evId);
      const data = await getEventBookingPage(this.pool, evId, req.session);
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][EVENT]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load event booking details',
      });
    }
  }

  async lockEvent(req, res) {
    try {
      const evId = Number(req.params.evId);
      const spaceRequired =
        req.body?.space_required ?? req.body?.spaceRequired ?? 0;
      const data = await lockEventSeats(
        this.pool,
        evId,
        spaceRequired,
        req.session,
        this.getAdminId(req)
      );
      return res.json({
        success: true,
        data,
        message: 'Spaces locked — continue to add booking',
      });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][LOCK]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to lock spaces',
      });
    }
  }

  async deleteProcessLock(req, res) {
    try {
      const lockId = Number(req.params.lockId);
      const data = await removeProcessLock(this.pool, lockId, req.session);
      return res.json({
        success: true,
        data,
        message: 'In-process booking lock removed',
      });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][DELETE_LOCK]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to remove lock',
      });
    }
  }

  async setFreeze(req, res) {
    try {
      const evId = Number(req.params.evId);
      const freeze = req.body?.freeze;
      const ceDates = req.body?.ceDates || req.body?.dates || {};
      const data = await setEventFreeze(this.pool, evId, freeze, ceDates);
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][FREEZE]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to update freeze state',
      });
    }
  }

  async getWizard(req, res) {
    try {
      const data = await getAddBookingWizard(this.pool, req.session);
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][WIZARD]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load add booking wizard',
      });
    }
  }

  async getWizardCustomer(req, res) {
    try {
      const customer = await getContactCard(this.pool, req.params.id);
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found',
        });
      }
      return res.json({ success: true, data: customer });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][CUSTOMER]', err.message);
      return res.status(500).json({
        success: false,
        message: err.message || 'Unable to load customer',
      });
    }
  }

  async searchWizardCustomers(req, res) {
    try {
      const q = req.query.q || req.query.search || '';
      const offset = req.query.offset;
      const limit = req.query.limit;
      const data = await searchExistingCustomers(this.pool, { q, offset, limit });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][CUSTOMER_SEARCH]', err.message);
      return res.status(500).json({
        success: false,
        message: err.message || 'Unable to search customers',
      });
    }
  }

  async submitWizardAttendees(req, res) {
    try {
      const data = await submitAddBookingAttendees(
        this.pool,
        req.session,
        req.body || {},
        this.getAdminId(req)
      );
      return res.json({
        success: true,
        data,
        message:
          data.payment_mode === 'cash'
            ? 'Booking saved successfully'
            : 'Continue to payment',
      });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][SUBMIT]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to save booking',
        code: err.code,
      });
    }
  }

  async cancelWizard(req, res) {
    try {
      const saveClient = Boolean(req.body?.save_client_details);
      const data = await cancelAddBookingWizard(
        this.pool,
        req.session,
        saveClient
      );
      return res.json({
        success: true,
        data,
        message: saveClient
          ? 'Booking cancelled — client details saved'
          : 'Booking cancelled',
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][CANCEL]', err.message);
      return res.status(500).json({
        success: false,
        message: err.message || 'Unable to cancel booking',
      });
    }
  }

  async getWizardWorldpay(req, res) {
    try {
      const data = await getBookingWorldpayPayload(this.pool, req.session);
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][WORLDPAY]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to start WorldPay payment',
      });
    }
  }

  async notifyWizardWorldpay(req, res) {
    try {
      const body = { ...(req.query || {}), ...(req.body || {}) };
      const result = await completeBookingWorldpayNotify(this.pool, body);
      res
        .status(200)
        .type('text/plain')
        .send(result.success ? 'OK' : 'FAILED');
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WORLDPAY][NOTIFY]', err.message);
      res.status(err.status || 500).type('text/plain').send('ERROR');
    }
  }

  async completeWizardWorldpay(req, res) {
    try {
      const body = { ...(req.query || {}), ...(req.body || {}) };
      const result = await handleBookingWorldpayBrowserComplete(
        this.pool,
        req.session,
        body
      );
      const adminBase = getAdminFrontendBase();
      return res.redirect(`${adminBase}${result.redirect_url}`);
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WORLDPAY][COMPLETE]', err.message);
      const adminBase = getAdminFrontendBase();
      return res.redirect(
        `${adminBase}/admin/dashboard?payment=failed&error=${encodeURIComponent(err.message || 'error')}`
      );
    }
  }

  async cancelWizardWorldpay(req, res) {
    try {
      const body = { ...(req.query || {}), ...(req.body || {}) };
      await cancelBookingWorldpay(this.pool, req.session, body);
      const adminBase = getAdminFrontendBase();
      const evId =
        Number(body.M_evId) ||
        Number(req.session?.adminBooking?.eventId) ||
        0;
      const redirect = evId
        ? `${adminBase}/admin/bookings/events/${evId}?payment=cancelled`
        : `${adminBase}/admin/dashboard?payment=cancelled`;
      return res.redirect(redirect);
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WORLDPAY][CANCEL]', err.message);
      const adminBase = getAdminFrontendBase();
      return res.redirect(`${adminBase}/admin/dashboard?payment=cancelled`);
    }
  }

  async finalizeWizardWorldpay(req, res) {
    try {
      const body = { ...(req.query || {}), ...(req.body || {}) };
      const result = await handleBookingWorldpayBrowserComplete(
        this.pool,
        req.session,
        body
      );
      return res.json({ success: true, data: result });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][WORLDPAY][FINALIZE]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to finalise WorldPay booking',
      });
    }
  }

  async getWizardConfirmation(req, res) {
    try {
      const evId = req.query.evId ? Number(req.query.evId) : undefined;
      const cartId = req.query.cartId || req.query.cartid || '';
      const data = await getBookingConfirmationDetails(this.pool, {
        evId,
        cartId,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][CONFIRMATION]', err.message);
      return res.status(500).json({
        success: false,
        message: err.message || 'Unable to load booking confirmation',
      });
    }
  }
}

module.exports = BookingsController;
