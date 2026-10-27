class DebugVoucherController {
  constructor(pool) {
    this.pool = pool;
  }

  async debugVoucherFlow(req, res) {
    try {
      // 1. Check bookings AUTO_INCREMENT
      const [autoInc] = await this.pool.query(
        `SELECT AUTO_INCREMENT as ai FROM information_schema.TABLES 
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bookings'`,
        [process.env.DB_NAME || '1stop']
      );

      // 2. Check gift_voucher_copieds
      const [copieds] = await this.pool.query(
        `SELECT bid, voucher_ref, created FROM gift_voucher_copieds ORDER BY created DESC LIMIT 5`
      );

      // 3. Check gift_voucher
      const [vouchers] = await this.pool.query(
        `SELECT bid, voucher_ref, created FROM gift_voucher ORDER BY created DESC LIMIT 5`
      );

      // 4. Check booking_payments for vouchers
      const [payments] = await this.pool.query(
        `SELECT booking_id, custom_payment_booking_ref, amount, created 
         FROM booking_payments 
         WHERE transation_type = 'custom_payment' 
         ORDER BY created DESC LIMIT 5`
      );

      // 5. Check actual bookings table
      const [bookings] = await this.pool.query(
        `SELECT id FROM bookings ORDER BY id DESC LIMIT 5`
      );

      res.json({
        success: true,
        debug_info: {
          bookings_auto_increment: autoInc[0]?.ai,
          latest_copieds: copieds,
          latest_vouchers: vouchers,
          latest_payments: payments,
          latest_booking_ids: bookings.map(b => b.id)
        }
      });

    } catch (error) {
      console.error('Debug error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  async manualProcessVoucher(req, res) {
    try {
      const payment_intent_id = req.body?.payment_intent_id || req.query.payment_intent_id;

      if (!payment_intent_id) {
        return res.status(400).json({
          success: false,
          error: 'payment_intent_id required (body or query)'
        });
      }

      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);

      if (paymentIntent.metadata?.type !== 'gift_voucher') {
        return res.status(400).json({
          success: false,
          error: 'Not a gift voucher payment'
        });
      }

      const StripeWebhookController = require('./stripeWebhook');
      const webhookController = new StripeWebhookController(this.pool);
      
      await webhookController.handleGiftVoucherPaymentIntent(paymentIntent);

      res.json({
        success: true,
        message: 'Voucher processed manually',
        voucher_ref: paymentIntent.metadata.voucher_ref
      });

    } catch (error) {
      console.error('Manual process error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = DebugVoucherController;
