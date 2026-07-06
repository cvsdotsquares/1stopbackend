const {
  loadWizard,
  switchWizardEvent,
  submitWizardAttendees,
  checkPromoCode,
  cancelPromoCode,
  loadCashConfirmation,
  searchExistingCustomers,
  getExistingCustomerById,
} = require('../services/bookingWizardService');
const {
  createAdminMotoStripeIntent,
  confirmAdminMotoStripePayment,
} = require('../services/adminMotoStripeService');

class BookingWizardController {
  constructor(pool) {
    this.pool = pool;
  }

  getAdminId(req) {
    const admin = req.session?.loggedinAdmin;
    return admin?.admin_id ?? admin?.id ?? null;
  }

  async getWizard(req, res) {
    try {
      const result = await loadWizard(this.pool, req);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
          redirect: result.redirect,
        });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WIZARD][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load booking wizard',
      });
    }
  }

  async postSwitchEvent(req, res) {
    try {
      const newEventId = Number(req.body?.newEventId ?? req.body?.new_event_id);
      const adminId = this.getAdminId(req);
      const result = await switchWizardEvent(this.pool, req, newEventId, adminId);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
          redirect: result.redirect,
        });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WIZARD][SWITCH]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to switch course event',
      });
    }
  }

  async postAttendees(req, res) {
    try {
      const adminId = this.getAdminId(req);
      const result = await submitWizardAttendees(this.pool, req, req.body, adminId);
      if (!result.ok) {
        const status = result.code === 'BLACKLISTED' ? 422 : 400;
        return res.status(status).json({
          success: false,
          message: result.message,
          code: result.code,
          blacklisted: result.blacklisted,
          redirect: result.redirect,
        });
      }
      return res.json({
        success: true,
        data: {
          paymentMode: result.paymentMode,
          redirect: result.redirect,
          bookingRefs: result.bookingRefs,
        },
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WIZARD][ATTENDEES]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to submit booking attendees',
      });
    }
  }

  async postPromoCheck(req, res) {
    try {
      const result = await checkPromoCode(this.pool, req, req.body);
      return res.json(result);
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WIZARD][PROMO-CHECK]', err.message);
      return res.status(500).json({
        status: 0,
        is_promo_code_valid: 0,
        promo_message: 'Promo Code is not valid.',
      });
    }
  }

  async postPromoCancel(req, res) {
    try {
      const result = await cancelPromoCode(req);
      return res.json(result);
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WIZARD][PROMO-CANCEL]', err.message);
      return res.status(500).json({
        status: 0,
        is_promo_code_valid: 0,
        promo_message: 'Promo Code is not valid.',
      });
    }
  }

  async postStripeCreateIntent(req, res) {
    try {
      const result = await createAdminMotoStripeIntent(this.pool, req);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
          redirect: result.redirect,
        });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][STRIPE][CREATE-INTENT]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to create Stripe payment',
      });
    }
  }

  async postStripeConfirm(req, res) {
    try {
      const paymentIntentId = String(
        req.body?.payment_intent_id || req.body?.paymentIntentId || ''
      ).trim();
      const evIdBefore = Number(req.session?.adminBooking?.eventId);
      const result = await confirmAdminMotoStripePayment(
        this.pool,
        req,
        paymentIntentId
      );
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
          redirect: result.redirect,
        });
      }
      const evId = result.evId || evIdBefore;
      return res.json({
        success: true,
        data: {
          redirect: `/admin/bookings/confirmation/cash?evId=${evId}`,
          evId,
        },
      });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][STRIPE][CONFIRM]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to confirm Stripe payment',
      });
    }
  }

  async searchCustomers(req, res) {
    try {
      const search = String(req.query.search || req.query.q || '').trim();
      const limit = Number(req.query.limit || 100);
      const customers = await searchExistingCustomers(this.pool, search, limit);
      return res.json({ success: true, data: { customers } });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WIZARD][CUSTOMERS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load customers',
      });
    }
  }

  async getCustomer(req, res) {
    try {
      const userId = Number(req.params.userId);
      const customer = await getExistingCustomerById(this.pool, userId);
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found',
        });
      }
      return res.json({ success: true, data: customer });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WIZARD][CUSTOMER]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load customer',
      });
    }
  }

  async getCashConfirmation(req, res) {
    try {
      const evId = Number(req.query.evId ?? req.params.evId);
      const result = await loadCashConfirmation(this.pool, req, evId);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
          redirect: result.redirect,
        });
      }
      return res.json({ success: true, data: result.data });
    } catch (err) {
      console.error('[ADMIN][BOOKINGS][WIZARD][CASH-CONFIRM]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load booking confirmation',
      });
    }
  }
}

module.exports = BookingWizardController;
