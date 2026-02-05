// src/controllers/worldpayWebhook.js
const fs = require('fs');
const path = require('path');

class WorldPayWebhookController {
  constructor(pool) {
    this.pool = pool;
  }

  async handlePaymentCallback(req, res) {
    // Always respond fast
    res.status(200).send('OK');

    try {
      const requestData = req.body;
      
      const bookingRefNumber = requestData.cartId || '';
      const orderKey = requestData.transId || '';
      const paymentStatus = requestData.transStatus || '';
      const transactionType = requestData.transaction_type || 'SALE';
      const authAmount = requestData.authAmount || null;
      const authCurrency = requestData.authCurrency || null;

      // Minimal logging
      const logData = {
        cartId: bookingRefNumber,
        transId: orderKey,
        status: paymentStatus,
        time: new Date().toISOString()
      };

      try {
        const logPath = path.join(__dirname, '../../logs/worldpay_callback.log');
        fs.appendFileSync(logPath, JSON.stringify(logData) + '\n');
      } catch (logError) {
        console.error('Failed to write log:', logError);
      }

      console.log('WorldPay Callback:', logData);

      // Only process successful payment
      if (paymentStatus !== 'Y' || !bookingRefNumber || !orderKey) {
        console.log('Payment not successful or missing data, skipping');
        return;
      }

      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        // Idempotency check - prevent duplicate processing
        const [existingPayment] = await connection.query(`
          SELECT COUNT(*) as count FROM booking_payments 
          WHERE transaction_id = ?
        `, [orderKey]);

        if (existingPayment[0].count > 0) {
          console.log('Payment already processed, skipping');
          await connection.rollback();
          connection.release();
          return;
        }

        // Split booking references (handle multiple bookings)
        const bookingRefs = bookingRefNumber.includes('-') 
          ? bookingRefNumber.split('-') 
          : [bookingRefNumber];

        const responseJson = JSON.stringify({
          cartId: bookingRefNumber,
          transId: orderKey,
          transStatus: paymentStatus,
          authAmount: authAmount,
          authCurrency: authCurrency
        });

        const processedBookings = [];

        // Process each booking
        for (const bref of bookingRefs) {
          // Find booking by reference
          const [attendeeData] = await connection.query(`
            SELECT booking_id, vehicle_type FROM booking_attendees 
            WHERE booking_ref = ? LIMIT 1
          `, [bref]);

          if (!attendeeData.length) {
            console.log(`No booking found for ref: ${bref}`);
            continue;
          }

          const bookingId = attendeeData[0].booking_id;

          // Get booking details
          const [bookingData] = await connection.query(`
            SELECT * FROM bookings WHERE id = ?
          `, [bookingId]);

          if (!bookingData.length) {
            console.log(`Booking not found: ${bookingId}`);
            continue;
          }

          const booking = bookingData[0];
          processedBookings.push(bookingId);

          // Get event details
          const [eventData] = await connection.query(`
            SELECT * FROM course_events WHERE id = ?
          `, [booking.course_event_id]);

          if (!eventData.length) {
            console.log(`Event not found: ${booking.course_event_id}`);
            continue;
          }

          const event = eventData[0];
          const paymentAmount = booking.total_amount;

          // Check capacity
          if (event.bookings_done >= event.booking_limit) {
            console.log(`Event full, marking as refundable: ${bookingId}`);
            
            // Mark as refundable if event is full
            await connection.query(`
              UPDATE bookings 
              SET refundable = 1, payment_due = payment_due - ?, status = 1, modified = NOW()
              WHERE id = ?
            `, [paymentAmount, bookingId]);

          } else {
            console.log(`Processing successful booking: ${bookingId}`);
            
            // Update event capacity
            await connection.query(`
              UPDATE course_events 
              SET bookings_done = bookings_done + ?, modified = NOW()
              WHERE id = ?
            `, [booking.spaces, booking.course_event_id]);

            // Update booking status
            await connection.query(`
              UPDATE bookings 
              SET payment_due = payment_due - ?, status = 1, admin_payment_received = 1, modified = NOW()
              WHERE id = ?
            `, [paymentAmount, bookingId]);
          }

          // Save payment record
          await connection.query(`
            INSERT INTO booking_payments (booking_id, payment_type, transaction_id, amount, email_status, response, created_at)
            VALUES (?, ?, ?, ?, 'no', ?, NOW())
          `, [bookingId, transactionType, orderKey, paymentAmount, responseJson]);

          // Remove lock if exists
          if (booking.lockid) {
            await connection.query(`
              UPDATE lock_bookings 
              SET delete_process = 1, modified = NOW() 
              WHERE id = ?
            `, [booking.lockid]);
            
            await connection.query(`
              DELETE FROM lock_bookings WHERE delete_process = 1
            `);
          }
        }

        await connection.commit();
        connection.release();

        console.log(`Payment processed successfully for bookings: ${processedBookings.join(', ')}`);

      } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Database error in payment processing:', error);
      }

    } catch (error) {
      console.error('WorldPay webhook error:', error);
    }
  }
}

module.exports = WorldPayWebhookController;