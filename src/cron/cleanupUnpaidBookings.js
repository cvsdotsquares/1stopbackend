// src/cron/cleanupUnpaidBookings.js
const cron = require('node-cron');

class BookingCleanupCron {
  constructor(pool) {
    this.pool = pool;
  }

  async cleanupUnpaidBookings() {
    const connection = await this.pool.getConnection();
    
    try {
      console.log('[CLEANUP CRON] Starting cleanup of unpaid bookings...');

      // Find unpaid bookings older than 30 minutes (configurable)
      const timeoutMinutes = process.env.BOOKING_TIMEOUT_MINUTES || 30;
      const [unpaidBookings] = await connection.query(`
        SELECT id, spaces, course_event_id
        FROM bookings
        WHERE status = 0
          AND admin_payment_received = 0
          AND created < DATE_SUB(NOW(), INTERVAL ? MINUTE)
      `, [timeoutMinutes]);

      if (unpaidBookings.length === 0) {
        console.log('[CLEANUP CRON] No unpaid bookings to clean up');
        return;
      }

      console.log(`[CLEANUP CRON] Found ${unpaidBookings.length} unpaid bookings to clean up`);

      for (const booking of unpaidBookings) {
        await connection.beginTransaction();

        try {
          // Release current_locks for this booking
          if (booking.course_event_id && booking.spaces) {
            await connection.query(`
              UPDATE course_events
              SET current_locks = GREATEST(0, current_locks - ?)
              WHERE id = ?
            `, [booking.spaces, booking.course_event_id]);
            console.log(`[CLEANUP CRON] Released ${booking.spaces} locks from event ${booking.course_event_id}`);
          }

          // Delete attendee records
          await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking.id]);
          await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking.id]);

          // Delete booking
          await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking.id]);

          await connection.commit();
          console.log(`[CLEANUP CRON] Deleted booking ID: ${booking.id}`);
        } catch (error) {
          await connection.rollback();
          console.error(`[CLEANUP CRON] Error deleting booking ${booking.id}:`, error);
        }
      }

      console.log('[CLEANUP CRON] Cleanup completed');
    } catch (error) {
      console.error('[CLEANUP CRON] Error during cleanup:', error);
    } finally {
      connection.release();
    }
  }

  start() {
    // Run every 15 minutes to catch abandoned bookings quickly
    cron.schedule('*/15 * * * *', () => {
      console.log('[CLEANUP CRON] Running scheduled cleanup...');
      this.cleanupUnpaidBookings();
    });

    console.log('[CLEANUP CRON] Scheduled to run every 15 minutes');
  }
}

module.exports = BookingCleanupCron;
