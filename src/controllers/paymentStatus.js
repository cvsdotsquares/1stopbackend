// src/controllers/paymentStatus.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class PaymentStatusController {
  constructor(pool) {
    this.pool = pool;
  }

  // Check payment and booking status
  async checkPaymentStatus(req, res) {
    try {
      const { session_id, booking_ref } = req.query;

      if (!session_id && !booking_ref) {
        return res.status(400).json({
          success: false,
          message: 'Session ID or booking reference required'
        });
      }

      let bookingId;
      let sessionData;

      // Get session data from Stripe
      if (session_id) {
        sessionData = await stripe.checkout.sessions.retrieve(session_id);
        bookingId = sessionData.metadata.booking_id;
      }

      // Get booking from database
      const [bookings] = await this.pool.query(`
        SELECT 
          b.id, b.booking_ref, b.status, b.admin_payment_received, 
          b.total_amount, b.course_event_id, b.spaces,
          ce.booking_limit, ce.bookings_done,
          c.course_name,
          r.stripe_refund_id, r.amount as refund_amount, r.status as refund_status
        FROM bookings b
        LEFT JOIN course_events ce ON b.course_event_id = ce.id
        LEFT JOIN courses c ON b.course_id = c.id
        LEFT JOIN refunds r ON b.id = r.booking_id
        WHERE b.id = ? OR b.booking_ref = ?
      `, [bookingId || 0, booking_ref || '']);

      if (!bookings.length) {
        // Booking was deleted (likely due to unavailability)
        return res.json({
          success: false,
          status: 'unavailable',
          message: 'Sorry, the course slots became unavailable after your payment.',
          refund_message: 'If any payment was deducted from your account, it will be refunded within 3 business days.',
          payment_status: sessionData?.payment_status || 'unknown'
        });
      }

      const booking = bookings[0];

      // Check if refund was initiated
      if (booking.stripe_refund_id) {
        return res.json({
          success: false,
          status: 'refunded',
          message: 'Sorry, the course slots became unavailable after your payment.',
          refund_message: 'A refund of £' + booking.refund_amount.toFixed(2) + ' has been initiated and will be processed within 3 business days.',
          refund_status: booking.refund_status,
          booking_ref: booking.booking_ref
        });
      }

      // Check booking status
      if (booking.status === 1 && booking.admin_payment_received === 1) {
        // Booking confirmed
        return res.json({
          success: true,
          status: 'confirmed',
          message: 'Your booking has been confirmed!',
          booking: {
            booking_ref: booking.booking_ref,
            course_name: booking.course_name,
            total_amount: booking.total_amount,
            spaces: booking.spaces
          }
        });
      } else if (booking.status === 0) {
        // Payment pending or processing
        return res.json({
          success: false,
          status: 'pending',
          message: 'Your payment is being processed. Please wait...',
          booking_ref: booking.booking_ref
        });
      } else {
        // Other status
        return res.json({
          success: false,
          status: 'unknown',
          message: 'Unable to confirm booking status. Please contact support.',
          booking_ref: booking.booking_ref
        });
      }

    } catch (error) {
      console.error('Error checking payment status:', error);
      res.status(500).json({
        success: false,
        message: 'Error checking payment status'
      });
    }
  }

  // Get refund status
  async getRefundStatus(req, res) {
    try {
      const { booking_ref } = req.params;

      const [refunds] = await this.pool.query(`
        SELECT 
          r.id, r.booking_id, r.stripe_refund_id, r.amount, 
          r.reason, r.status, r.created,
          b.booking_ref, b.total_amount
        FROM refunds r
        JOIN bookings b ON r.booking_id = b.id
        WHERE b.booking_ref = ?
      `, [booking_ref]);

      if (!refunds.length) {
        return res.status(404).json({
          success: false,
          message: 'No refund found for this booking'
        });
      }

      const refund = refunds[0];

      res.json({
        success: true,
        refund: {
          amount: refund.amount,
          status: refund.status,
          reason: refund.reason,
          created: refund.created,
          message: 'Refund will be processed within 3 business days'
        }
      });

    } catch (error) {
      console.error('Error getting refund status:', error);
      res.status(500).json({
        success: false,
        message: 'Error getting refund status'
      });
    }
  }
}

module.exports = PaymentStatusController;
