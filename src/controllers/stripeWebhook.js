// src/controllers/stripeWebhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class StripeWebhookController {
  constructor(pool) {
    this.pool = pool;
  }

  async handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    // Temporary: Skip signature verification for testing
    if (endpointSecret === 'whsec_...') {
      console.log('⚠️  Using webhook without signature verification (testing mode)');
      event = req.body;
    } else {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        console.log('Stripe webhook event received:', event.type);
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    }

    try {
      console.log(`📨 Processing webhook event: ${event.type}`);
      console.log(`📋 Event data:`, JSON.stringify(event.data?.object?.metadata || {}, null, 2));

      switch (event.type) {
        case 'payment_intent.created':
          console.log('ℹ️ Payment intent created (no action needed)');
          break;
        case 'payment_intent.succeeded':
          await this.handlePaymentSuccess(event.data.object);
          console.log('✅ Payment intent succeeded (handled via checkout.session.completed)');
          break;
        case 'payment_intent.payment_failed':
          console.log('❌ Handling payment failed...');
          await this.handlePaymentFailed(event.data.object);
          break;
        default:
          console.log(`⚠️ Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  async handlePaymentSuccess(session) {
    console.log('🔄 Processing successful payment for session:', session.id);
    console.log('📋 Session metadata:', session.metadata);

    const { booking_id, booking_ref } = session.metadata || {};

    if (!booking_id) {
      console.error('❌ No booking_id in session metadata');
      return;
    }

    console.log(`🎯 Processing booking ${booking_id} (${booking_ref})`);

    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      console.log(`🔍 Checking for existing payment with transaction ID: ${session.payment_intent || session.id}`);

      // Idempotency check - prevent duplicate processing (like original PHP)
      const [existingPayment] = await connection.query(`
        SELECT id FROM booking_payments
        WHERE transation_id = ?
      `, [session.payment_intent || session.id]);

      if (existingPayment.length > 0) {
        console.log(`⚠️ Payment already processed for session ${session.id}`);
        await connection.commit();
        return;
      }

      console.log('📋 Getting booking and event details...');

      // Get booking and event details
      const [bookingDetails] = await connection.query(`
        SELECT b.id, b.course_event_id, b.spaces, b.lockid, b.admin_payment_received, b.payment_due,
               ce.bookings_done, ce.booking_limit, ce.parent
        FROM bookings b
        JOIN course_events ce ON b.course_event_id = ce.id
        WHERE b.id = ?
      `, [booking_id]);

      if (bookingDetails.length === 0) {
        console.error(`❌ Booking ${booking_id} not found`);
        await connection.rollback();
        return;
      }

      const booking = bookingDetails[0];
      console.log('📋 Booking details:', booking);
      const { course_event_id, spaces, lockid, admin_payment_received, payment_due } = booking;
      const { bookings_done, booking_limit, parent } = booking;

      // Calculate actual payment amount from Stripe session
      const paidAmount = session.amount_total / 100; // Convert from pence to pounds

      // Check capacity (like original PHP logic)
      if (bookings_done >= booking_limit) {
        console.log(`Event ${course_event_id} is full, marking as refundable`);

        // Mark as refundable and confirmed
        await connection.query(`
          UPDATE bookings
          SET refundable = 1,
              payment_due = 0,
              admin_payment_received = ?,
              status = 1,
              modified = NOW()
          WHERE id = ?
        `, [paidAmount, booking_id]);

      } else {
        // Normal booking confirmation
        console.log(`Confirming booking ${booking_id}`);

        // Update course events (using parent like PHP)
        await connection.query(`
          UPDATE course_events
          SET bookings_done = bookings_done + ?
          WHERE parent = ?
        `, [spaces, parent]);

        // Update booking status
        await connection.query(`
          UPDATE bookings
          SET payment_due = 0,
              admin_payment_received = ?,
              status = 1,
              modified = NOW()
          WHERE id = ?
        `, [paidAmount, booking_id]);
      }

      // Save payment record (like original PHP)
      const paymentData = {
        booking_id: booking_id,
        payment_type: 'SALE',
        transation_id: session.payment_intent || session.id,
        amount: paidAmount,
        transation_type: 'booking',
        response: JSON.stringify({
          session_id: session.id,
          payment_status: session.payment_status,
          amount_total: session.amount_total,
          currency: session.currency
        })
      };

      await connection.query(`
        INSERT INTO booking_payments
        (booking_id, payment_type, transation_id, amount, transation_type, response, created, isDelete, custom_payment_booking_ref, voucher_serilized_response)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), 0, '', '')
      `, [
        paymentData.booking_id,
        paymentData.payment_type,
        paymentData.transation_id,
        paymentData.amount,
        paymentData.transation_type,
        paymentData.response
      ]);

      // Remove lock if exists
      if (lockid) {
        await connection.query(`
          DELETE FROM lock_bookings WHERE id = ?
        `, [lockid]);

        // Also update current_locks
        await connection.query(`
          UPDATE course_events
          SET current_locks = GREATEST(0, current_locks - ?)
          WHERE id = ?
        `, [spaces, course_event_id]);
      }

      await connection.commit();
      console.log(`Payment confirmed for booking ${booking_ref}`);

    } catch (error) {
      await connection.rollback();
      console.error('Error updating booking after payment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async handlePaymentExpired(session) {
    console.log('Processing expired payment for session:', session.id);

    const { booking_id } = session.metadata;

    if (!booking_id) {
      console.error('No booking_id in session metadata');
      return;
    }

    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      // Update booking status to cancelled (status = 3)
      await connection.query(`
        UPDATE bookings
        SET status = 3,
            modified = NOW()
        WHERE id = ? AND status = 0
      `, [booking_id]);

      // Get booking details to release locks
      const [bookingDetails] = await connection.query(`
        SELECT course_event_id, spaces
        FROM bookings
        WHERE id = ?
      `, [booking_id]);

      if (bookingDetails.length > 0) {
        const { course_event_id, spaces } = bookingDetails[0];

        // Release locks
        await connection.query(`
          UPDATE course_events
          SET current_locks = GREATEST(0, current_locks - ?),
              modified = NOW()
          WHERE id = ?
        `, [spaces, course_event_id]);
      }

      await connection.commit();
      console.log(`Payment expired for booking ${booking_id}`);

    } catch (error) {
      await connection.rollback();
      console.error('Error handling expired payment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async handlePaymentFailed(paymentIntent) {
    console.log('Processing failed payment for payment intent:', paymentIntent.id);

    // Find booking by payment intent
    const [bookings] = await this.pool.query(`
      SELECT id FROM bookings
      WHERE id = ?
    `, [paymentIntent.metadata?.booking_id]);

    if (bookings.length === 0) {
      console.log('No booking found for payment intent:', paymentIntent.id);
      return;
    }

    const booking = bookings[0];

    console.log(`Payment failed for booking ${booking.id}`);
  }

  // Verify payment status (for frontend callbacks)
  async verifyPayment(req, res) {
    // Add CORS headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    console.log('Verifying payment with query:', req.query);
    try {
      const { payment_intent, ref } = req.query;
      console.log('Booking ref:', ref, 'Payment intent:', payment_intent);

      if (!payment_intent || !ref) {
        return res.status(400).json({
          success: false,
          error: 'Missing payment_intent or ref'
        });
      }

      // Get payment intent from Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent);

      // Get booking from database using booking_attendees table
      const [bookings] = await this.pool.query(`
        SELECT b.id, b.status, b.total_amount, b.payment_due, b.admin_payment_received
        FROM bookings b
        JOIN booking_attendees ba ON b.id = ba.booking_id
        WHERE ba.booking_ref = ?
        LIMIT 1
      `, [ref]);

      if (bookings.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Booking not found'
        });
      }

      const booking = bookings[0];

      res.json({
        success: true,
        data: {
          booking_id: booking.id,
          booking_ref: ref,
          payment_status: paymentIntent.status,
          booking_status: booking.status,
          amount_paid: paymentIntent.amount_received / 100,
          payment_due: booking.payment_due
        }
      });

    } catch (error) {
      console.error('Error verifying payment:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify payment'
      });
    }
  }
}

module.exports = StripeWebhookController;