// Manual payment completion for testing
const express = require('express');
const mysql = require('mysql2/promise');

const router = express.Router();

module.exports = (pool) => {
  // Manual payment completion endpoint for testing
  router.post('/manual-complete/:booking_id', async (req, res) => {
    const { booking_id } = req.params;
    const { transaction_id = `manual_${Date.now()}` } = req.body;
    
    console.log(`🔧 Manual payment completion for booking ${booking_id}`);
    
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Get booking details
      const [bookingDetails] = await connection.query(`
        SELECT b.id, b.course_event_id, b.spaces, b.lockid, b.admin_payment_received,
               ce.bookings_done, ce.booking_limit, ce.parent
        FROM bookings b
        JOIN course_events ce ON b.course_event_id = ce.id
        WHERE b.id = ?
      `, [booking_id]);
      
      if (bookingDetails.length === 0) {
        throw new Error(`Booking ${booking_id} not found`);
      }
      
      const booking = bookingDetails[0];
      console.log('📋 Booking details:', booking);
      
      // Update booking status
      await connection.query(`
        UPDATE bookings 
        SET payment_due = payment_due - ?,
            status = 1,
            modified = NOW()
        WHERE id = ?
      `, [booking.admin_payment_received || 0, booking.id]);
      
      // Update course events if not full
      if (booking.bookings_done < booking.booking_limit) {
        await connection.query(`
          UPDATE course_events 
          SET bookings_done = bookings_done + ?
          WHERE parent = ?
        `, [booking.spaces, booking.parent]);
      } else {
        await connection.query(`
          UPDATE bookings 
          SET refundable = 1
          WHERE id = ?
        `, [booking.id]);
      }
      
      // Insert payment record
      await connection.query(`
        INSERT INTO booking_payments 
        (booking_id, payment_type, transation_id, amount, transation_type, response, created, isDelete, custom_payment_booking_ref, voucher_serilized_response)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), 0, '', '')
      `, [
        booking.id,
        'SALE',
        transaction_id,
        booking.admin_payment_received || 0,
        'booking',
        JSON.stringify({ manual_completion: true, timestamp: new Date().toISOString() })
      ]);
      
      // Remove lock
      if (booking.lockid) {
        await connection.query(`DELETE FROM lock_bookings WHERE id = ?`, [booking.lockid]);
        await connection.query(`
          UPDATE course_events 
          SET current_locks = GREATEST(0, current_locks - ?)
          WHERE id = ?
        `, [booking.spaces, booking.course_event_id]);
      }
      
      await connection.commit();
      
      res.json({
        success: true,
        message: `Payment completed for booking ${booking_id}`,
        booking_id,
        transaction_id
      });
      
    } catch (error) {
      await connection.rollback();
      console.error('❌ Manual payment completion failed:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    } finally {
      connection.release();
    }
  });
  
  return router;
};