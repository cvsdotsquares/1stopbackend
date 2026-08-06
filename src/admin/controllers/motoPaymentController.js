const {
  listMotoFranchises,
  initiateMotoPayment,
  completeMotoFromCallback,
  cancelMotoPayment,
  getMotoPaymentStatus,
  mockCompleteMoto,
  getAdminFrontendBase,
  resolveMotoIntegrationMode,
  isMockMode,
  getWorldpayCurrency,
} = require('../services/motoPaymentService');

class MotoPaymentController {
  constructor(pool) {
    this.pool = pool;
  }

  async options(req, res) {
    try {
      const franchises = await listMotoFranchises(this.pool);
      return res.json({
        success: true,
        data: {
          franchises,
          currency: getWorldpayCurrency(),
          mock_mode: isMockMode(),
          integration: isMockMode() ? 'mock' : resolveMotoIntegrationMode(),
        },
      });
    } catch (error) {
      console.error('[moto] options error', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Unable to load MOTO options',
      });
    }
  }

  async initiate(req, res) {
    try {
      const data = await initiateMotoPayment(this.pool, req.body || {}, req.session);
      return res.json({ success: true, data, message: data.message });
    } catch (error) {
      const status = error.status || 500;
      console.error('[moto] initiate error', error);
      return res.status(status).json({
        success: false,
        message: error.message || 'Unable to start MOTO payment',
      });
    }
  }

  async notify(req, res) {
    try {
      const body = { ...(req.query || {}), ...(req.body || {}) };
      const paymentType = String(
        body.M_paymentType || body.m_paymenttype || ''
      ).toLowerCase();
      if (paymentType === 'course_booking') {
        const {
          completeBookingWorldpayNotify,
        } = require('../services/bookingWorldpayService');
        const result = await completeBookingWorldpayNotify(this.pool, body);
        res
          .status(200)
          .type('text/plain')
          .send(result.success ? 'OK' : 'FAILED');
        return;
      }
      const result = await completeMotoFromCallback(this.pool, body);
      // WorldPay Payment Response expects a simple acknowledgement
      res.status(200).type('text/plain').send(result.success ? 'OK' : 'FAILED');
    } catch (error) {
      console.error('[moto] notify error', error);
      res.status(error.status || 500).type('text/plain').send('ERROR');
    }
  }

  async browserResult(req, res) {
    const body = { ...(req.query || {}), ...(req.body || {}) };
    const adminBase = getAdminFrontendBase();
    const cartId =
      body.cartId || body.cartid || body.MC_order_id || body.ref || '';
    const transStatus = String(body.transStatus || body.transstatus || '').toUpperCase();
    const statusHint = String(body.status || '').toLowerCase();

    try {
      const treatAsSuccess =
        transStatus === 'Y' ||
        statusHint === 'success' ||
        (statusHint !== 'cancel' &&
          statusHint !== 'failed' &&
          statusHint !== 'failure' &&
          statusHint !== 'expiry' &&
          transStatus === 'Y');

      if (treatAsSuccess || statusHint === 'success') {
        const result = await completeMotoFromCallback(this.pool, body, {
          forceSuccess: statusHint === 'success' || transStatus === 'Y',
          allowMissingStatus: statusHint === 'success',
        });
        const resultRef = result.order_id || cartId;
        return res.redirect(
          `${adminBase}/admin/payments/moto/result?status=success&ref=${encodeURIComponent(resultRef)}`
        );
      }

      // Cancel / expiry / abandon: remove placeholder booking + pending payment.
      if (
        statusHint === 'cancel' ||
        statusHint === 'expiry' ||
        statusHint === 'expired'
      ) {
        await cancelMotoPayment(this.pool, body);
        return res.redirect(
          `${adminBase}/admin/payments/moto/result?status=cancel&ref=${encodeURIComponent(cartId)}`
        );
      }

      // Declined / failed: mark payment and drop placeholder booking.
      if (transStatus && transStatus !== 'Y') {
        await completeMotoFromCallback(this.pool, body);
      } else {
        await cancelMotoPayment(this.pool, body);
      }

      return res.redirect(
        `${adminBase}/admin/payments/moto/result?status=${encodeURIComponent(
          statusHint === 'cancel' ? 'cancel' : 'failed'
        )}&ref=${encodeURIComponent(cartId)}`
      );
    } catch (error) {
      console.error('[moto] browserResult error', error);
      try {
        await cancelMotoPayment(this.pool, body);
      } catch (cleanupError) {
        console.error('[moto] cancel cleanup error', cleanupError);
      }
      return res.redirect(
        `${adminBase}/admin/payments/moto/result?status=failed&ref=${encodeURIComponent(
          cartId
        )}&error=${encodeURIComponent(error.message || 'error')}`
      );
    }
  }

  async status(req, res) {
    try {
      const ref = req.params.ref || req.query.ref;
      const data = await getMotoPaymentStatus(this.pool, ref);
      return res.json({ success: true, data });
    } catch (error) {
      return res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Unable to load payment status',
      });
    }
  }

  async mockComplete(req, res) {
    try {
      const ref = req.body?.ref || req.params.ref || req.query.ref;
      const data = await mockCompleteMoto(this.pool, ref);
      return res.json({ success: true, data, message: data.message });
    } catch (error) {
      return res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Mock complete failed',
      });
    }
  }
}

module.exports = MotoPaymentController;
