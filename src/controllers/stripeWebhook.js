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
        case 'payment_intent.canceled':
          console.log('❌ Handling payment canceled...');
          await this.handlePaymentCanceled(event.data.object);
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

        // Lock event and move from current_locks to bookings_done
        const [eventDetails] = await connection.query(`
          SELECT bookings_done, current_locks, booking_limit FROM course_events WHERE id = ? FOR UPDATE
        `, [course_event_id]);

        if (eventDetails.length > 0) {
          const currentLocks = eventDetails[0].current_locks || 0;
          const bookingsDone = eventDetails[0].bookings_done || 0;
          console.log(`📊 bookings_done: ${bookingsDone}, current_locks: ${currentLocks}, confirming: ${bookingSpaces}`);

          // Move spaces from current_locks to bookings_done
          await connection.query(`
            UPDATE course_events
            SET bookings_done = bookings_done + ?,
                current_locks = GREATEST(0, current_locks - ?),
                modified = NOW()
            WHERE id = ?
          `, [bookingSpaces, bookingSpaces, course_event_id]);
          console.log(`✅ Decremented current_locks by ${bookingSpaces}, Incremented bookings_done by ${bookingSpaces}`);
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

    const { type, bid, booking_id, course_event_id, attendees_count } = paymentIntent.metadata || {};

    // Handle gift voucher payment failure
    if (type === 'gift_voucher' && bid) {
      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        // Delete the gift voucher copied entry
        await connection.query(
          `DELETE FROM gift_voucher_copieds WHERE bid = ?`,
          [bid]
        );
        console.log(`🗑️ Deleted gift_voucher_copieds entry for bid ${bid}`);

        // Delete the placeholder booking row
        await connection.query(
          `DELETE FROM bookings WHERE id = ? AND booking_made_by = 'gift_voucher'`,
          [bid]
        );
        console.log(`🗑️ Deleted placeholder booking row for bid ${bid} due to payment failure`);

        await connection.commit();
        console.log(`✅ Cleaned up failed gift voucher payment for bid ${bid}`);
      } catch (error) {
        await connection.rollback();
        console.error('❌ Error cleaning up failed gift voucher payment:', error);
      } finally {
        connection.release();
      }
      return;
    }

    // Handle regular booking payment failure - immediate cleanup
    if (booking_id) {
      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        // Get booking details
        const [bookings] = await connection.query(`
          SELECT id, spaces, course_event_id FROM bookings
          WHERE id = ? AND status = 0 AND admin_payment_received = 0
        `, [booking_id]);

        if (bookings.length === 0) {
          console.log('No unpaid booking found for payment intent:', paymentIntent.id);
          await connection.rollback();
          return;
        }

        const booking = bookings[0];
        console.log(`❌ Payment failed for booking ${booking.id} - initiating immediate cleanup`);

        // Release current_locks for this booking
        if (booking.course_event_id && booking.spaces) {
          await connection.query(`
            UPDATE course_events
            SET current_locks = GREATEST(0, current_locks - ?)
            WHERE id = ?
          `, [booking.spaces, booking.course_event_id]);
          console.log(`🔓 Released ${booking.spaces} locks from event ${booking.course_event_id}`);
        }

        // Delete attendee records
        await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking.id]);
        await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking.id]);
        console.log(`🗑️ Deleted attendee records for booking ${booking.id}`);

        // Delete booking
        await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking.id]);
        console.log(`🗑️ Deleted booking ${booking.id}`);

        await connection.commit();
        console.log(`✅ Successfully cleaned up failed payment for booking ${booking.id}`);
      } catch (error) {
        await connection.rollback();
        console.error('❌ Error cleaning up failed booking payment:', error);
      } finally {
        connection.release();
      }
    }
  }

  async handlePaymentCanceled(paymentIntent) {
    console.log('Processing canceled payment for payment intent:', paymentIntent.id);

    const { type, bid, booking_id, course_event_id, attendees_count } = paymentIntent.metadata || {};

    // Handle gift voucher payment cancellation
    if (type === 'gift_voucher' && bid) {
      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        // Delete the gift voucher copied entry
        await connection.query(
          `DELETE FROM gift_voucher_copieds WHERE bid = ?`,
          [bid]
        );
        console.log(`🗑️ Deleted gift_voucher_copieds entry for bid ${bid}`);

        // Delete the placeholder booking row
        await connection.query(
          `DELETE FROM bookings WHERE id = ? AND booking_made_by = 'gift_voucher'`,
          [bid]
        );
        console.log(`🗑️ Deleted placeholder booking row for bid ${bid} due to payment cancellation`);

        await connection.commit();
        console.log(`✅ Cleaned up canceled gift voucher payment for bid ${bid}`);
      } catch (error) {
        await connection.rollback();
        console.error('❌ Error cleaning up canceled gift voucher payment:', error);
      } finally {
        connection.release();
      }
      return;
    }

    // Handle regular booking payment cancellation - immediate cleanup
    if (booking_id) {
      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        // Get booking details
        const [bookings] = await connection.query(`
          SELECT id, spaces, course_event_id FROM bookings
          WHERE id = ? AND status = 0 AND admin_payment_received = 0
        `, [booking_id]);

        if (bookings.length === 0) {
          console.log('No unpaid booking found for payment intent:', paymentIntent.id);
          await connection.rollback();
          return;
        }

        const booking = bookings[0];
        console.log(`🚫 Payment canceled for booking ${booking.id} - initiating immediate cleanup`);

        // Release current_locks for this booking
        if (booking.course_event_id && booking.spaces) {
          await connection.query(`
            UPDATE course_events
            SET current_locks = GREATEST(0, current_locks - ?)
            WHERE id = ?
          `, [booking.spaces, booking.course_event_id]);
          console.log(`🔓 Released ${booking.spaces} locks from event ${booking.course_event_id}`);
        }

        // Delete attendee records
        await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking.id]);
        await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking.id]);
        console.log(`🗑️ Deleted attendee records for booking ${booking.id}`);

        // Delete booking
        await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking.id]);
        console.log(`🗑️ Deleted booking ${booking.id}`);

        await connection.commit();
        console.log(`✅ Successfully cleaned up canceled payment for booking ${booking.id}`);
      } catch (error) {
        await connection.rollback();
        console.error('❌ Error cleaning up canceled booking payment:', error);
      } finally {
        connection.release();
      }
    }
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

      // Check if voucher already exists in gift_voucher table
      const uniqueVoucherRef = `1SGV${vouchers[0].bid} - OGV`;
      const [existingVoucher] = await connection.query(
        `SELECT id FROM gift_voucher WHERE bid = ?`,
        [bid]
      );

      if (existingVoucher.length > 0) {
        console.log(`⚠️ Gift voucher with bid ${bid} already exists in gift_voucher table`);
        await connection.rollback();
        return;
      }

      const vData = vouchers[0];
      const paidAmount = (paymentIntent.amount_received || paymentIntent.amount) / 100;
      const voucherDate = new Date().toLocaleDateString('en-GB');

      // Insert into gift_voucher with unique reference
      console.log(`📝 Inserting gift voucher with bid ${vData.bid} and ref ${uniqueVoucherRef}`);
      console.log(`📊 Voucher data:`, JSON.stringify({
        bid: vData.bid,
        voucher_ref: uniqueVoucherRef,
        user_id: vData.user_id,
        voucher_value: vData.voucher_value,
        voucher_person: vData.voucher_person,
        voucher_email: vData.voucher_email
      }, null, 2));

      let insertResult;
      try {
        [insertResult] = await connection.query(
          `INSERT INTO gift_voucher
           (voucher_date, voucher_ref, bid, user_id, subject, voucher_person,
            voucher_free_text, voucher_value, purchased_by, voucher_contact,
            voucher_email, voucher_payement_type, template_id,
            redeem_note, franchise_to_paid, created)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'o', ?, '', ?, NOW())`,
          [voucherDate, uniqueVoucherRef, vData.bid, vData.user_id || 0,
           vData.subject || '', vData.voucher_person, vData.voucher_free_text || '',
           vData.voucher_value, vData.purchased_by, vData.voucher_contact || '',
           vData.voucher_email, vData.template_id || 1, vData.franchise_to_paid || 1]
        );
        console.log(`✅ Gift voucher inserted with ID ${insertResult.insertId}`);
      } catch (insertError) {
        console.error(`❌ CRITICAL: Failed to insert into gift_voucher table:`, insertError);
        console.error(`SQL Error Code: ${insertError.code}, SQLState: ${insertError.sqlState}`);
        console.error(`Error Message: ${insertError.message}`);
        throw insertError;
      }


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

      // Delete the placeholder booking row that was created to reserve the ID
      await connection.query(
        `DELETE FROM bookings WHERE id = ? AND booking_made_by = 'gift_voucher'`,
        [vData.bid]
      );
      console.log(`🗑️ Deleted placeholder booking row for bid ${vData.bid}`);

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
      console.error('❌ Error processing gift voucher payment intent:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        sqlState: error.sqlState,
        sql: error.sql,
        bid: bid
      });
      throw error;
    } finally {
      connection.release();
    }
  }

  async handleGiftVoucherPayment(session) {
    console.log('🎁 Processing gift voucher payment:', session.id);

    const { bid } = session.metadata;

    if (!bid) {
      console.error('❌ No bid in session metadata');
      return;
    }

    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      // Idempotency check - check if voucher already exists in gift_voucher table
      const [existingVoucher] = await connection.query(
        `SELECT id FROM gift_voucher WHERE bid = ?`,
        [bid]
      );

      if (existingVoucher.length > 0) {
        console.log(`⚠️ Gift voucher with bid ${bid} already exists in gift_voucher table`);
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
      const paidAmount = (session.amount || session.amount_total || 0) / 100;

      // Generate unique voucher_ref using bid (each bid is unique)
      const uniqueVoucherRef = `1SGV${vData.bid} - OGV`;
      const voucherDate = new Date().toLocaleDateString('en-GB');

      // Insert into gift_voucher with unique reference
      console.log(`📝 Inserting gift voucher with bid ${vData.bid} and ref ${uniqueVoucherRef}`);
      console.log(`📊 Voucher data:`, JSON.stringify({
        bid: vData.bid,
        voucher_ref: uniqueVoucherRef,
        user_id: vData.user_id,
        voucher_value: vData.voucher_value,
        voucher_person: vData.voucher_person,
        voucher_email: vData.voucher_email
      }, null, 2));

      let insertResult;
      try {
        [insertResult] = await connection.query(
          `INSERT INTO gift_voucher
           (voucher_date, voucher_ref, bid, user_id, subject, voucher_person,
            voucher_free_text, voucher_value, purchased_by, voucher_contact,
            voucher_email, voucher_payement_type, template_id,
            redeem_note, franchise_to_paid, created)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'o', ?, '', ?, NOW())`,
          [voucherDate, uniqueVoucherRef, vData.bid, vData.user_id || 0,
           vData.subject || '', vData.voucher_person, vData.voucher_free_text || '',
           vData.voucher_value, vData.purchased_by, vData.voucher_contact || '',
           vData.voucher_email, vData.template_id || 1, vData.franchise_to_paid || 1]
        );
        console.log(`✅ Gift voucher inserted with ID ${insertResult.insertId}`);
      } catch (insertError) {
        console.error(`❌ CRITICAL: Failed to insert into gift_voucher table:`, insertError);
        console.error(`SQL Error Code: ${insertError.code}, SQLState: ${insertError.sqlState}`);
        console.error(`Error Message: ${insertError.message}`);
        throw insertError;
      }


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

      // Delete the placeholder booking row that was created to reserve the ID
      await connection.query(
        `DELETE FROM bookings WHERE id = ? AND booking_made_by = 'gift_voucher'`,
        [vData.bid]
      );
      console.log(`🗑️ Deleted placeholder booking row for bid ${vData.bid}`);

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
      console.error('❌ Error processing gift voucher payment (checkout session):', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        sqlState: error.sqlState,
        sql: error.sql,
        bid: bid
      });
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = StripeWebhookController;