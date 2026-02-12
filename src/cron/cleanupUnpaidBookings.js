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

      // Find unpaid bookings older than 1 day
      const [unpaidBookings] = await connection.query(`
        SELECT id, spaces, course_event_id
        FROM bookings
        WHERE status = 0
          AND admin_payment_received = 0
          AND created < DATE_SUB(NOW(), INTERVAL 1 DAY)
      `);

      if (unpaidBookings.length === 0) {
        console.log('[CLEANUP CRON] No unpaid bookings to clean up');
        return;
      }

      console.log(`[CLEANUP CRON] Found ${unpaidBookings.length} unpaid bookings to clean up`);

      for (const booking of unpaidBookings) {
        await connection.beginTransaction();

        try {
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
    // Run every day at 2 AM
    cron.schedule('0 2 * * *', () => {
      console.log('[CLEANUP CRON] Running scheduled cleanup...');
      this.cleanupUnpaidBookings();
    });

    console.log('[CLEANUP CRON] Scheduled to run daily at 2 AM');
  }
}

module.exports = BookingCleanupCron;
