// src/controllers/webhookHandler.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class WebhookHandler {
  constructor(pool) {
    this.pool = pool;
  }

  async handleStripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log('Stripe webhook event:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await this.handleSuccessfulPayment(session);
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      await this.handleFailedPayment(session);
    }

    res.json({ received: true });
  }

  async handleSuccessfulPayment(session) {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      const { booking_id, course_event_id, attendees_count } = session.metadata;

      console.log('Processing successful payment for booking:', booking_id);

      // Check availability again with row lock
      const [event] = await connection.query(`
        SELECT booking_limit, bookings_done FROM course_events WHERE id = ? FOR UPDATE
      `, [course_event_id]);

      if (!event.length) {
        throw new Error('Event not found');
      }

      const availableSpaces = event[0].booking_limit - event[0].bookings_done;
      const spacesNeeded = parseInt(attendees_count);

      // Check if slots are still available
      if (availableSpaces < spacesNeeded) {
        console.log(`Insufficient spaces after payment. Available: ${availableSpaces}, Needed: ${spacesNeeded}`);
        
        // Initiate refund
        await this.initiateRefund(session.payment_intent, booking_id);
        
        // Delete booking and attendees
        await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking_id]);
        await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking_id]);
        await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking_id]);
        
        await connection.commit();
        connection.release();
        
        console.log(`Refund initiated for booking ${booking_id} - slots unavailable`);
        return { refunded: true, message: 'Slots unavailable, refund initiated' };
      }

      // Slots available - confirm booking
      await connection.query(`
        UPDATE bookings
        SET status = 1, payment_due = 0, admin_payment_received = total_amount, modified = NOW()
        WHERE id = ?
      `, [booking_id]);

      // Insert payment record
      await connection.query(`
        INSERT INTO booking_payments (booking_id, payment_type, transation_id, response, amount, created, isDelete, transation_type)
        VALUES (?, 'stripe', ?, ?, ?, NOW(), 0, 'booking')
      `, [booking_id, session.payment_intent, JSON.stringify(session), session.amount_total / 100]);

      // Increment bookings_done
      await connection.query(`
        UPDATE course_events
        SET bookings_done = bookings_done + ?, modified = NOW()
        WHERE id = ?
      `, [spacesNeeded, course_event_id]);

      await connection.commit();
      console.log('Booking confirmed successfully:', booking_id);
      
      return { confirmed: true };

    } catch (error) {
      await connection.rollback();
      console.error('Error processing successful payment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async initiateRefund(paymentIntentId, bookingId) {
    try {
      console.log(`Initiating refund for payment intent: ${paymentIntentId}`);
      
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        metadata: {
          booking_id: bookingId.toString(),
          reason: 'Course fully booked'
        }
      });

      console.log('Refund created:', refund.id);
      
      // Store refund information
      await this.pool.query(`
        INSERT INTO refunds (booking_id, stripe_refund_id, amount, reason, status, created)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [bookingId, refund.id, refund.amount / 100, 'Course fully booked', refund.status]);
      
      return refund;
    } catch (error) {
      console.error('Error initiating refund:', error);
      throw error;
    }
  }

  async handleFailedPayment(session) {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();

    try {
      const { booking_id } = session.metadata;

      console.log('Processing failed/expired payment for booking:', booking_id);

      // Delete attendee records
      await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking_id]);
      await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking_id]);

      // Delete booking
      await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking_id]);

      await connection.commit();
      console.log('Failed booking cleaned up:', booking_id);

    } catch (error) {
      await connection.rollback();
      console.error('Error processing failed payment:', error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Manual payment confirmation endpoint
  async confirmPayment(req, res) {
    try {
      const { booking_ref, session_id } = req.body;

      if (!booking_ref && !session_id) {
        return res.status(400).json({ success: false, message: 'Booking reference or session ID required' });
      }

      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        let booking;

        if (session_id) {
          // Verify with Stripe
          const session = await stripe.checkout.sessions.retrieve(session_id);
          
          if (session.payment_status !== 'paid') {
            throw new Error('Payment not completed');
          }

          booking = await this.handleSuccessfulPayment(session);
        } else {
          // Manual confirmation by booking_ref
          const [bookings] = await connection.query(`
            SELECT b.id, b.course_event_id, b.spaces
            FROM bookings b
            WHERE b.id = (SELECT id FROM bookings WHERE id LIKE ? LIMIT 1)
          `, [`%${booking_ref}%`]);

          if (!bookings.length) {
            throw new Error('Booking not found');
          }

          booking = bookings[0];

          // Get booking amount
          const [bookingData] = await connection.query(`
            SELECT total_amount FROM bookings WHERE id = ?
          `, [booking.id]);

          await connection.query(`
            UPDATE bookings
            SET status = 1, payment_due = 0, admin_payment_received = total_amount, modified = NOW()
            WHERE id = ?
          `, [booking.id]);

          // Insert manual payment record
          await connection.query(`
            INSERT INTO booking_payments (booking_id, payment_type, transation_id, response, amount, created, isDelete, transation_type)
            VALUES (?, 'manual', ?, ?, ?, NOW(), 0, 'booking')
          `, [booking.id, `MANUAL_${booking.id}_${Date.now()}`, 'Manual payment confirmation', bookingData[0].total_amount]);

          await connection.query(`
            UPDATE course_events
            SET bookings_done = bookings_done + ?, modified = NOW()
            WHERE id = ?
          `, [booking.spaces, booking.course_event_id]);
        }

        await connection.commit();
        connection.release();

        res.json({ success: true, message: 'Payment confirmed successfully' });

      } catch (error) {
        await connection.rollback();
        connection.release();
        throw error;
      }

    } catch (error) {
      console.error('Error confirming payment:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = WebhookHandler;
