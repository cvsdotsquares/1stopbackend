// src/controllers/stripeWebhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendGiftVoucherEmail } = require('../utils/emailService');

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
          const paymentIntent = event.data.object;
          if (paymentIntent.metadata?.type === 'gift_voucher') {
            await this.handleGiftVoucherPaymentIntent(paymentIntent);
          } else {
            await this.handlePaymentSuccess(paymentIntent);
          }
          console.log('✅ Payment intent succeeded');
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

    // Check if gift voucher
    if (session.metadata?.type === 'gift_voucher') {
      return this.handleGiftVoucherPayment(session);
    }

    const { booking_id, course_event_id, spaces, attendees_count } = session.metadata || {};

    // New flow: booking already created by bookingFlow.js
    if (booking_id && course_event_id && (spaces || attendees_count)) {
      const bookingSpaces = parseInt(spaces || attendees_count);
      console.log(`💼 Processing payment for existing booking ${booking_id}`);

      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        // Idempotency check
        const [existingPayment] = await connection.query(`
          SELECT id FROM booking_payments WHERE transation_id = ?
        `, [session.payment_intent || session.id]);

        if (existingPayment.length > 0) {
          console.log(`⚠️ Payment already processed`);
          await connection.commit();
          return;
        }

        const paidAmount = (session.amount_received || session.amount || 0) / 100;

        // Lock and update bookings_done
        const [eventDetails] = await connection.query(`
          SELECT bookings_done, booking_limit FROM course_events WHERE id = ? FOR UPDATE
        `, [course_event_id]);

        if (eventDetails.length > 0) {
          const availableSpaces = eventDetails[0].booking_limit - eventDetails[0].bookings_done;
          console.log(`📊 bookings_done: ${eventDetails[0].bookings_done}, available: ${availableSpaces}, requested: ${bookingSpaces}`);

          if (availableSpaces >= bookingSpaces) {
            await connection.query(`
              UPDATE course_events
              SET bookings_done = bookings_done + ?, modified = NOW()
              WHERE id = ?
            `, [bookingSpaces, course_event_id]);
            console.log(`✅ Incremented bookings_done by ${bookingSpaces}`);
          } else {
            console.log(`⚠️ Not enough space. Available: ${availableSpaces}, Requested: ${bookingSpaces}`);
          }
        }

        // Update booking status
        await connection.query(`
          UPDATE bookings
          SET admin_payment_received = ?, status = 1, modified = NOW()
          WHERE id = ?
        `, [paidAmount, booking_id]);

        // Save payment record
        await connection.query(`
          INSERT INTO booking_payments
          (booking_id, payment_type, transation_id, amount, transation_type, response, created, isDelete, custom_payment_booking_ref, voucher_serilized_response)
          VALUES (?, 'SALE', ?, ?, 'booking', ?, NOW(), 0, '', '')
        `, [booking_id, session.payment_intent || session.id, paidAmount, JSON.stringify({ session_id: session.id, payment_status: session.payment_status })]);

        await connection.commit();
        console.log(`✅ Payment confirmed for booking ${booking_id}`);
      } catch (error) {
        await connection.rollback();
        console.error('Error:', error);
        throw error;
      } finally {
        connection.release();
      }
      return;
    }

    // Old flow with temp_ref and booking_data
    console.error('❌ No booking_id in metadata');
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
    try {
      const { payment_intent, temp_ref } = req.query;

      if (!payment_intent) {
        return res.status(400).json({
          success: false,
          error: 'Missing payment_intent'
        });
      }

      // Get payment intent from Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent);

      // If payment succeeded, try to find the created booking
      if (paymentIntent.status === 'succeeded') {
        const [bookings] = await this.pool.query(`
          SELECT b.id, b.status, b.total_amount, b.payment_due, b.admin_payment_received,
                 ba.booking_ref
          FROM bookings b
          JOIN booking_attendees ba ON b.id = ba.booking_id
          WHERE ba.\`primary\` = 1
          AND b.created >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
          ORDER BY b.created DESC
          LIMIT 1
        `);

        if (bookings.length > 0) {
          const booking = bookings[0];
          return res.json({
            success: true,
            data: {
              booking_id: booking.id,
              booking_ref: booking.booking_ref,
              payment_status: paymentIntent.status,
              booking_status: booking.status,
              amount_paid: paymentIntent.amount_received / 100,
              payment_due: booking.payment_due
            }
          });
        }
      }

      // Payment not yet processed or failed
      res.json({
        success: true,
        data: {
          payment_status: paymentIntent.status,
          temp_ref: temp_ref || null,
          message: paymentIntent.status === 'succeeded' ? 'Payment processing...' : 'Payment pending'
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

  async handleGiftVoucherPaymentIntent(paymentIntent) {
    console.log('🎁 Processing gift voucher payment intent:', paymentIntent.id);

    const { bid, voucher_ref } = paymentIntent.metadata;

    if (!bid) {
      console.error('❌ No bid in metadata');
      return;
    }

    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      // Idempotency check - prevent duplicate processing
      const [existingPayment] = await connection.query(
        `SELECT id FROM booking_payments WHERE transation_id = ?`,
        [paymentIntent.id]
      );

      if (existingPayment.length > 0) {
        console.log(`⚠️ Gift voucher ${voucher_ref} already processed`);
        await connection.rollback();
        return;
      }

      const [vouchers] = await connection.query(
        `SELECT * FROM gift_voucher_copieds WHERE bid = ?`,
        [bid]
      );

      if (vouchers.length === 0) {
        console.error(`❌ Gift voucher ${bid} not found`);
        await connection.rollback();
        return;
      }

      const vData = vouchers[0];
      const paidAmount = (paymentIntent.amount_received || paymentIntent.amount) / 100;

      // Generate unique voucher_ref using bid (each bid is unique)
      const uniqueVoucherRef = `1SGV${vData.bid} - OGV`;
      const voucherDate = new Date().toLocaleDateString('en-GB');

      // Insert into gift_voucher with unique reference
      const [insertResult] = await connection.query(
        `INSERT INTO gift_voucher
         (voucher_date, voucher_ref, bid, user_id, subject, voucher_person,
          voucher_free_text, voucher_value, purchased_by, voucher_contact,
          voucher_email, voucher_payement_type, template_id,
          redeem_note, franchise_to_paid, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'o', ?, '', ?, NOW())`,
        [voucherDate, uniqueVoucherRef, vData.bid, vData.user_id,
         vData.subject, vData.voucher_person, vData.voucher_free_text,
         vData.voucher_value, vData.purchased_by, vData.voucher_contact,
         vData.voucher_email, vData.template_id, vData.franchise_to_paid]
      );

      // Fetch the actual inserted voucher data for email
      const [actualVoucher] = await connection.query(
        `SELECT * FROM gift_voucher WHERE id = ?`,
        [insertResult.insertId]
      );

      await connection.query(
        `INSERT INTO booking_payments
         (transation_id, response, booking_id, payment_type, amount,
          created, transation_type, transation_extra_info, custom_payment_booking_ref, isDelete, voucher_serilized_response)
         VALUES (?, ?, ?, 'Online', ?, NOW(), 'custom_payment', ?, ?, 0, '')`,
        [
          paymentIntent.id,
          JSON.stringify(paymentIntent),
          vData.bid,
          paidAmount,
          JSON.stringify({
            payee_name: vData.voucher_person,
            payment_description: `Gift Voucher For ${vData.subject}`,
            franchise: vData.franchise_to_paid
          }),
          uniqueVoucherRef
        ]
      );

      await connection.commit();
      console.log(`✅ Gift voucher ${actualVoucher[0].voucher_ref} payment confirmed`);

      // Send email with actual voucher data
      try {
        await sendGiftVoucherEmail(actualVoucher[0], this.pool);
        console.log(`📧 Gift voucher email sent to ${actualVoucher[0].voucher_email}`);
      } catch (emailError) {
        console.error('❌ Error sending gift voucher email:', emailError);
      }

    } catch (error) {
      await connection.rollback();
      console.error('❌ Error processing gift voucher payment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async handleGiftVoucherPayment(session) {
    console.log('🎁 Processing gift voucher payment:', session.id);

    const { bid, voucher_ref } = session.metadata;

    if (!bid) {
      console.error('❌ No bid in session metadata');
      return;
    }

    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      const [vouchers] = await connection.query(
        `SELECT * FROM gift_voucher_copieds WHERE bid = ?`,
        [bid]
      );

      if (vouchers.length === 0) {
        console.error(`❌ Gift voucher ${bid} not found`);
        await connection.rollback();
        return;
      }

      const vData = vouchers[0];
      const paidAmount = (session.amount || session.amount_total || 0) / 100;

      // Generate unique voucher_ref using bid (each bid is unique)
      const uniqueVoucherRef = `1SGV${vData.bid} - OGV`;
      const voucherDate = new Date().toLocaleDateString('en-GB');

      // Insert into gift_voucher with unique reference
      const [insertResult] = await connection.query(
        `INSERT INTO gift_voucher
         (voucher_date, voucher_ref, bid, user_id, subject, voucher_person,
          voucher_free_text, voucher_value, purchased_by, voucher_contact,
          voucher_email, voucher_payement_type, template_id,
          redeem_note, franchise_to_paid, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'o', ?, '', ?, NOW())`,
        [voucherDate, uniqueVoucherRef, vData.bid, vData.user_id,
         vData.subject, vData.voucher_person, vData.voucher_free_text,
         vData.voucher_value, vData.purchased_by, vData.voucher_contact,
         vData.voucher_email, vData.template_id, vData.franchise_to_paid]
      );

      // Fetch the actual inserted voucher data for email
      const [actualVoucher] = await connection.query(
        `SELECT * FROM gift_voucher WHERE id = ?`,
        [insertResult.insertId]
      );

      await connection.query(
        `INSERT INTO booking_payments
         (transation_id, response, booking_id, payment_type, amount,
          created, transation_type, transation_extra_info, custom_payment_booking_ref, isDelete, voucher_serilized_response)
         VALUES (?, ?, ?, 'Online', ?, NOW(), 'custom_payment', ?, ?, 0, '')`,
        [
          session.payment_intent || session.id,
          JSON.stringify({
            session_id: session.id,
            payment_status: session.payment_status,
            amount_total: session.amount_total,
            currency: session.currency
          }),
          vData.bid,
          paidAmount,
          JSON.stringify({
            payee_name: vData.voucher_person,
            payment_description: `Gift Voucher For ${vData.subject}`,
            franchise: vData.franchise_to_paid
          }),
          uniqueVoucherRef
        ]
      );

      await connection.commit();
      console.log(`✅ Gift voucher ${actualVoucher[0].voucher_ref} payment confirmed`);

      // Send email with actual voucher data
      try {
        await sendGiftVoucherEmail(actualVoucher[0], this.pool);
        console.log(`📧 Gift voucher email sent to ${actualVoucher[0].voucher_email}`);
      } catch (emailError) {
        console.error('❌ Error sending gift voucher email:', emailError);
      }

    } catch (error) {
      await connection.rollback();
      console.error('❌ Error processing gift voucher payment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = StripeWebhookController;