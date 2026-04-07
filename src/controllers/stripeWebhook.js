// src/controllers/stripeWebhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendGiftVoucherEmail } = require('../utils/emailService');
const { formatDateToDDMMYYYY } = require('../utils/dateFormat');

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

    const { booking_id, booking_ids, course_event_id, spaces, attendees_count } = session.metadata || {};

    // New flow: booking already created by bookingFlow.js
    // Support both multi-booking (booking_ids) and legacy single booking (booking_id)
    const allBookingIds = booking_ids
      ? booking_ids.split(',').map(id => parseInt(id, 10)).filter(Boolean)
      : booking_id ? [parseInt(booking_id, 10)] : [];

    if (allBookingIds.length > 0 && course_event_id && (spaces || attendees_count)) {
      const bookingSpaces = Number.parseInt(spaces || attendees_count, 10);
      console.log(`💼 Processing payment for bookings: ${allBookingIds.join(', ')}`);

      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        // Idempotency check against the primary booking
        const [existingPayment] = await connection.query(`
          SELECT id FROM booking_payments WHERE transation_id = ?
        `, [session.payment_intent || session.id]);

        if (existingPayment.length > 0) {
          console.log(`⚠️ Payment already processed`);
          await connection.commit();
          return;
        }

        const paidAmount = (session.amount_received || session.amount || 0) / 100;

        // Prefer per-booking amounts from the booking records, so mixed own/school values (e.g. 200 + 300) are preserved.
        const placeholderList = allBookingIds.map(() => '?').join(',');
        const [bookingRows] = await connection.query(
          `SELECT id, total_amount, payment_due FROM bookings WHERE id IN (${placeholderList})`,
          allBookingIds
        );

        const bookingAmounts = allBookingIds.map((bid) => {
          const b = bookingRows.find((row) => Number(row.id) === Number(bid));
          if (!b) return paidAmount / allBookingIds.length;

          const amount = Number(b.total_amount || 0) - Number(b.payment_due || 0);
          return Math.max(amount, 0);
        });

        const computedTotal = bookingAmounts.reduce((sum, amount) => sum + amount, 0);
        const fallbackPerBookingAmount = paidAmount / allBookingIds.length;

        console.log('Stripe webhook bookingAmounts', {
          allBookingIds,
          bookingRows,
          bookingAmounts,
          paidAmount,
          computedTotal,
          fallbackPerBookingAmount
        });

        // If the computed total differs from paid amount (e.g. rounding or partial payments), preserve the paid amount.
        if (Math.abs(computedTotal - paidAmount) > 0.01 || computedTotal <= 0) {
          console.log('Stripe webhook fallback to equal split payment amounts');
          // fallback to equal split if no valid booking amount breakdown exists
          for (let i = 0; i < bookingAmounts.length; i += 1) {
            bookingAmounts[i] = fallbackPerBookingAmount;
          }
        }

        // Lock event and move from current_locks to bookings_done
        const [eventDetails] = await connection.query(`
          SELECT bookings_done, current_locks, booking_limit FROM course_events WHERE id = ? FOR UPDATE
        `, [course_event_id]);

        if (eventDetails.length > 0) {
          await connection.query(`
            UPDATE course_events
            SET bookings_done = bookings_done + ?,
                current_locks = GREATEST(0, current_locks - ?),
                modified = NOW()
            WHERE id = ?
          `, [bookingSpaces, bookingSpaces, course_event_id]);
          console.log(`✅ Decremented current_locks by ${bookingSpaces}, Incremented bookings_done by ${bookingSpaces}`);
        }

        // Update each booking status and insert a payment record for each
        // payment_due and admin_payment_received are already set correctly at booking creation time
        let assignedSum = 0;
        const useBookingAmounts = computedTotal > 0 && Math.abs(computedTotal - paidAmount) <= 0.5;

        for (let i = 0; i < allBookingIds.length; i += 1) {
          const bid = allBookingIds[i];
          const amountForBooking = useBookingAmounts
            ? (i === allBookingIds.length - 1 ? paidAmount - assignedSum : bookingAmounts[i])
            : fallbackPerBookingAmount;

          assignedSum += amountForBooking;

          await connection.query(`
            UPDATE bookings SET status = 1, modified = NOW() WHERE id = ?
          `, [bid]);

          await connection.query(`
            INSERT INTO booking_payments
            (booking_id, payment_type, transation_id, amount, transation_type, response, created, isDelete, custom_payment_booking_ref, voucher_serilized_response)
            VALUES (?, 'SALE', ?, ?, 'booking', ?, NOW(), 0, '', '')
          `, [bid, session.payment_intent || session.id, amountForBooking, JSON.stringify({ session_id: session.id, payment_status: session.payment_status })]);
        }

        await connection.commit();
        console.log(`✅ Payment confirmed for bookings: ${allBookingIds.join(', ')}`);

        // Send confirmation email for each booking
        for (const bid of allBookingIds) {
          try {
            await this.sendBookingConfirmationEmail(bid);
          } catch (emailError) {
            console.error(`❌ Failed to send confirmation email for booking ${bid}:`, emailError);
          }
        }
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
      // Get booking details with lock
      const [bookings] = await connection.query(`
        SELECT id, spaces, course_event_id, status, admin_payment_received
        FROM bookings
        WHERE id = ? FOR UPDATE
      `, [booking_id]);

      if (bookings.length === 0) {
        console.log('No booking found for expired payment:', booking_id);
        await connection.rollback();
        return;
      }

      const booking = bookings[0];

      // Only cleanup if booking hasn't been paid
      if (booking.admin_payment_received > 0) {
        console.log('Booking already paid, no cleanup needed:', booking_id);
        await connection.rollback();
        return;
      }

      console.log(`⏱️ Payment expired for booking ${booking_id} - initiating cleanup`);

      // Release current_locks for this booking - CRITICAL
      if (booking.course_event_id && booking.spaces) {
        await connection.query(`
          UPDATE course_events
          SET current_locks = GREATEST(0, current_locks - ?),
              modified = NOW()
          WHERE id = ?
        `, [booking.spaces, booking.course_event_id]);
        console.log(`🔓 Released ${booking.spaces} locks from event ${booking.course_event_id}`);
      }

      // Delete attendee records (which also deletes booking references)
      await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking.id]);
      await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking.id]);
      console.log(`🗑️ Deleted attendee records for booking ${booking.id}`);

      // Delete booking
      await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking.id]);
      console.log(`🗑️ Deleted booking ${booking.id}`);

      await connection.commit();
      console.log(`✅ Successfully cleaned up expired payment for booking ${booking.id}`);

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

    const { type, bid, booking_id, booking_ids, course_event_id, attendees_count } = paymentIntent.metadata || {};

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
    const allBookingIds = booking_ids
      ? booking_ids.split(',').map(id => parseInt(id, 10)).filter(Boolean)
      : booking_id ? [parseInt(booking_id, 10)] : [];

    if (allBookingIds.length > 0) {
      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        for (const bid of allBookingIds) {
          const [bookings] = await connection.query(`
            SELECT id, spaces, course_event_id, status, admin_payment_received FROM bookings
            WHERE id = ? FOR UPDATE
          `, [bid]);

          if (bookings.length === 0 || bookings[0].admin_payment_received > 0) continue;

          const booking = bookings[0];

          if (booking.course_event_id && booking.spaces) {
            await connection.query(`
              UPDATE course_events
              SET current_locks = GREATEST(0, current_locks - ?), modified = NOW()
              WHERE id = ?
            `, [booking.spaces, booking.course_event_id]);
          }

          await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [bid]);
          await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [bid]);
          await connection.query(`DELETE FROM bookings WHERE id = ?`, [bid]);
          console.log(`🗑️ Cleaned up failed booking ${bid}`);
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        console.error('❌ Error cleaning up failed booking payment:', error);
      } finally {
        connection.release();
      }
    } else {
      console.error('❌ No booking_ids or gift voucher bid in payment failed metadata');
    }
  }

  async handlePaymentCanceled(paymentIntent) {
    console.log('Processing canceled payment for payment intent:', paymentIntent.id);

    const { type, bid, booking_id, booking_ids, course_event_id, attendees_count } = paymentIntent.metadata || {};

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

    // Handle regular booking payment cancellation - same as failure
    const allCanceledBookingIds = booking_ids
      ? booking_ids.split(',').map(id => parseInt(id, 10)).filter(Boolean)
      : booking_id ? [parseInt(booking_id, 10)] : [];

    if (allCanceledBookingIds.length > 0) {
      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        for (const bid of allCanceledBookingIds) {
          const [bookings] = await connection.query(`
            SELECT id, spaces, course_event_id, status, admin_payment_received FROM bookings
            WHERE id = ? FOR UPDATE
          `, [bid]);

          if (bookings.length === 0 || bookings[0].admin_payment_received > 0) continue;

          const booking = bookings[0];

          if (booking.course_event_id && booking.spaces) {
            await connection.query(`
              UPDATE course_events
              SET current_locks = GREATEST(0, current_locks - ?), modified = NOW()
              WHERE id = ?
            `, [booking.spaces, booking.course_event_id]);
          }

          await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [bid]);
          await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [bid]);
          await connection.query(`DELETE FROM bookings WHERE id = ?`, [bid]);
          console.log(`🗑️ Cleaned up canceled booking ${bid}`);
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        console.error('❌ Error cleaning up canceled booking payment:', error);
      } finally {
        connection.release();
      }
    } else {
      console.error('❌ No booking_ids or gift voucher bid in payment canceled metadata');
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
      const voucherDate = formatDateToDDMMYYYY(new Date());

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
      const voucherDate = formatDateToDDMMYYYY(new Date());

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

  // Send booking confirmation email after payment is confirmed
  async sendBookingConfirmationEmail(booking_id) {
    const connection = await this.pool.getConnection();
    try {
      // Get booking details.
      // NOTE: In multi-attendee checkout each attendee can be created as a separate booking,
      // and only the first booking may have `primary = 1` in booking_attendees.
      // So do not require `primary = 1` here; select the best attendee row per booking.
      const [bookings] = await connection.query(`
        SELECT
          b.id, b.course_id, b.course_event_id, b.total_amount,
          b.payment_due, b.vat, b.total_fees,
          ba.booking_ref, ba.email
        FROM bookings b
        JOIN booking_attendees ba ON b.id = ba.booking_id
        WHERE b.id = ?
        ORDER BY ba.primary DESC, ba.id ASC
        LIMIT 1
      `, [booking_id]);

      if (bookings.length === 0) {
        console.log(`⚠️ Booking not found for email: ${booking_id}`);
        return;
      }

      const booking = bookings[0];

      // Get all attendees for this booking
      const [attendees] = await connection.query(`
        SELECT first_name, sur_name, email, contact1, contact2, contact3, vehicle_type
        FROM booking_attendees
        WHERE booking_id = ?
      `, [booking_id]);

      // Get course details
      const [courseData] = await connection.query(`
        SELECT email_content, course_name FROM courses WHERE id = ?
      `, [booking.course_id]);

      // Get location details
      const [locationData] = await connection.query(`
        SELECT location_name, address1, address2, address3, address4,
               postcode, direction_map, direction_content
        FROM locations
        WHERE id = (SELECT location_id FROM course_events WHERE id = ?)
      `, [booking.course_event_id]);

      // Get event dates
      const [eventDates] = await connection.query(`
        SELECT event_date, event_start_time
        FROM course_event_dates
        WHERE course_event_id = ?
        ORDER BY event_date ASC, event_start_time ASC
      `, [booking.course_event_id]);

      // Get franchise details
      const [franchiseData] = await connection.query(`
        SELECT f.email_header, f.email_footer, f.email_logo, f.website,
               f.telephone, f.freephone, f.franchise_email
        FROM franchise f
        JOIN course_events ce ON ce.franchise_id = f.id
        WHERE ce.id = ?
        LIMIT 1
      `, [booking.course_event_id]);

      // Get settings
      const [settingsData] = await connection.query(`
        SELECT booking_bcc FROM settings LIMIT 1
      `);

      const { sendBookingConfirmation } = require('../utils/emailService');

      await sendBookingConfirmation({
        course_name: courseData[0]?.course_name || 'Course',
        booking_ref: booking.booking_ref,
        booking_type: 'o',
        refundable: 0,
        attendees: attendees,
        location: locationData[0] || {},
        event_dates: eventDates,
        booking: {
          total_amount: booking.total_amount,
          payment_due: Math.max(0, booking.payment_due),
          vat: booking.vat,
          total_fees: booking.total_fees
        },
        course_email_content: courseData[0]?.email_content || '',
        franchise: franchiseData[0] || {},
        bcc: settingsData[0]?.booking_bcc || 'bookings@1stopinstruction.com',
        ip: 'webhook'
      }, this.pool);

      console.log(`📧 Booking confirmation email sent for booking ${booking_id} (${booking.booking_ref})`);
    } catch (error) {
      console.error('❌ Error sending booking confirmation email:', error);
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = StripeWebhookController;