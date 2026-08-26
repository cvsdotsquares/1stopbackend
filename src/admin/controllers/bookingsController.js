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
  checkAdminBookingPromoCode,
  cancelAdminBookingPromoCode,
} = require('../services/addBookingWizardService');
const {
  getBookingWorldpayPayload,
  completeBookingWorldpayNotify,
  cancelBookingWorldpay,
  handleBookingWorldpayBrowserComplete,
  getBookingConfirmationDetails,
} = require('../services/bookingWorldpayService');
const {
  getAdminStripePaymentLink,
  expireAdminStripePaymentLink,
} = require('../services/bookingStripeLinkService');
const {
  getBookingView,
  getEditBookingForm,
  updateBooking,
} = require('../services/editBookingService');
const {
  getDeleteMailTemplate,
  refundBooking: refundAdminBooking,
  deleteBooking: deleteAdminBookingRecord,
} = require('../services/adminBookingRefundDeleteService');
const { getAdminFrontendBase } = require('../services/motoPaymentService');
const { getInProgressBookings } = require('../services/inProgressBookingsService');
const {
  getInvoice,
  saveInvoice,
  emailInvoice,
} = require('../services/bookingInvoiceService');

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
      await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
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
            : data.payment_mode === 'stripe'
              ? 'Stripe payment link created'
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
        saveClient,
        this.getAdminId(req)
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

  async checkWizardPromo(req, res) {
    try {
      const data = await checkAdminBookingPromoCode(
        this.pool,
        req.session,
        req.body || {}
      );
      const ok = Number(data.is_promo_code_valid) === 1;
      return res.json({
        success: ok,
        data,
        message:
          data.promo_message ||
          (ok ? 'Promo Code Accepted.' : 'Promo Code is not valid.'),
      });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][PROMO]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to validate promo code',
      });
    }
  }

  async cancelWizardPromo(req, res) {
    try {
      const data = cancelAdminBookingPromoCode(req.session);
      return res.json({
        success: true,
        data,
        message: data.promo_message || 'Promo code removed',
      });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][PROMO][CANCEL]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to remove promo code',
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

  async getWizardStripeLink(req, res) {
    try {
      const data = await getAdminStripePaymentLink(this.pool, req.session);
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][STRIPE_LINK]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load Stripe payment link',
      });
    }
  }

  async cancelWizardStripeLink(req, res) {
    try {
      const stored = req.session?.stripePaymentLink || {};
      const result = await expireAdminStripePaymentLink(
        this.pool,
        {
          checkout_session_id: stored.checkout_session_id,
          metadata: {
            type: 'admin_payment_link',
            booking_ids: (stored.booking_ids || []).join(','),
          },
        },
        req.session
      );
      return res.json({
        success: true,
        data: result,
        message: 'Stripe payment link cancelled',
      });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][STRIPE_LINK][CANCEL]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to cancel Stripe payment link',
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

  async getBooking(req, res) {
    try {
      const data = await getBookingView(this.pool, req.params.id);
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][VIEW]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load booking',
        code: err.code,
        deleted_booking_id: err.deleted_booking_id,
      });
    }
  }

  async getBookingEditForm(req, res) {
    try {
      const newEventId = req.query.newEventId || req.query.new_event_id || null;
      const data = await getEditBookingForm(this.pool, req.params.id, {
        newEventId,
      });
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][EDIT]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load edit booking form',
      });
    }
  }

  async patchBooking(req, res) {
    try {
      const data = await updateBooking(
        this.pool,
        req.params.id,
        req.body || {},
        this.getAdminId(req),
        req.session
      );
      await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][UPDATE]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to update booking',
        code: err.code,
      });
    }
  }

  async getDeleteMailTemplate(req, res) {
    try {
      const data = await getDeleteMailTemplate(this.pool, req.params.id);
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][DELETE-TEMPLATE]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load delete email template',
      });
    }
  }

  async refundBooking(req, res) {
    try {
      const bookingId =
        req.body?.recordRefund ?? req.body?.booking_id ?? req.params.id;
      const data = await refundAdminBooking(
        this.pool,
        bookingId,
        this.getAdminId(req)
      );
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][REFUND]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to refund booking',
      });
    }
  }

  async deleteBooking(req, res) {
    try {
      const bookingId =
        req.body?.recordDelete ?? req.body?.booking_id ?? req.params.id;
      const data = await deleteAdminBookingRecord(
        this.pool,
        bookingId,
        this.getAdminId(req),
        req.body || {}
      );
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][DELETE]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to delete booking',
      });
    }
  }

  async getInProgressBookings(req, res) {
    try {
      const data = await getInProgressBookings(this.pool, req.session);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][IN-PROGRESS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load in-progress bookings',
      });
    }
  }

  async getInvoice(req, res) {
    try {
      const data = await getInvoice(this.pool, req.params.id);
      return res.json({ success: true, data });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][INVOICE]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Unable to load invoice',
      });
    }
  }

  async saveInvoice(req, res) {
    try {
      const data = await saveInvoice(this.pool, req.params.id, req.body || {});
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][INVOICE-SAVE]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Error in saving invoice',
      });
    }
  }

  async emailInvoice(req, res) {
    try {
      const email =
        req.body?.email_invoice ?? req.body?.email ?? '';
      const data = await emailInvoice(this.pool, req.params.id, email);
      return res.json({ success: true, data, message: data.message });
    } catch (err) {
      const status = err.status || 500;
      console.error('[ADMIN][BOOKINGS][INVOICE-EMAIL]', err.message);
      return res.status(status).json({
        success: false,
        message: err.message || 'Error on sending email',
      });
    }
  }
}

module.exports = BookingsController;
