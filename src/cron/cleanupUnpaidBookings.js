// src/cron/cleanupUnpaidBookings.js
//
// Periodic cleanup for abandoned `status = 0` (pending payment) booking
// rows. Mirrors the legacy PHP delete flow in
// 1stop-php/admin/booking_refund_delete_common.php:
//   - hard-DELETE from `bookings`
//   - hard-DELETE from `booking_attendees` (and `booking_attendees_dropdown`)
//   - soft-delete `booking_payments` (isDelete = 1)
//   - INSERT a serialized snapshot into `deleted_bookings`
//   - INSERT an audit row into `booking_update_history`
//   - release the held seats on `course_events.current_locks`
//
// Note: we deliberately DO NOT scan for `status = 3`. The previous
// implementation queried `(status = 0 OR status = 3)` because an earlier
// version of bookingStatusManager auto-wrote `status = 3` for "cancelled".
// That value is not part of the legacy schema and is no longer produced
// anywhere in this code base.
const cron = require('node-cron');
const { phpSerialize } = require('../utils/phpSerialize');

class BookingCleanupCron {
  constructor(pool) {
    this.pool = pool;
  }

  async cleanupUnpaidBookings() {
    const connection = await this.pool.getConnection();

    try {
      console.log('[CLEANUP CRON] Starting cleanup of unpaid bookings...');

      const timeoutMinutes = process.env.BOOKING_TIMEOUT_MINUTES || 30;
      const [unpaidBookings] = await connection.query(`
        SELECT b.*
        FROM bookings b
        WHERE b.status = 0
          AND b.admin_payment_received = 0
          AND b.created < DATE_SUB(NOW(), INTERVAL ? MINUTE)
      `, [timeoutMinutes]);

      if (unpaidBookings.length === 0) {
        console.log('[CLEANUP CRON] No unpaid bookings to clean up');
        return;
      }

      console.log(`[CLEANUP CRON] Found ${unpaidBookings.length} unpaid bookings to clean up`);

      for (const booking of unpaidBookings) {
        await connection.beginTransaction();

        try {
          if (booking.booking_made_by === 'gift_voucher') {
            await connection.query(
              `DELETE FROM gift_voucher_copieds WHERE bid = ?`,
              [booking.id]
            );
            await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking.id]);
            console.log(`[CLEANUP CRON] Deleted abandoned gift voucher booking ID: ${booking.id}`);
            await connection.commit();
            continue;
          }

          if (booking.course_event_id && booking.spaces) {
            await connection.query(`
              UPDATE course_events
              SET current_locks = GREATEST(0, current_locks - ?),
                  modified = NOW()
              WHERE id = ?
            `, [booking.spaces, booking.course_event_id]);
          }

          const [primaryAttendeeRows] = await connection.query(
            `SELECT *
             FROM booking_attendees
             WHERE booking_id = ?
             ORDER BY \`primary\` DESC, id ASC
             LIMIT 1`,
            [booking.id]
          );
          const primaryAttendee = primaryAttendeeRows[0] || {};
          primaryAttendee.full_name = `${(primaryAttendee.first_name || '').trim()} ${(primaryAttendee.sur_name || '').trim()}`.trim();

          const [courseRows] = await connection.query(
            `SELECT course_abb FROM courses WHERE id = ? LIMIT 1`,
            [booking.course_id]
          );
          const [eventLocationRows] = await connection.query(
            `SELECT ce.location_id, l.location_name
             FROM course_events ce
             LEFT JOIN locations l ON ce.location_id = l.id
             WHERE ce.id = ?
             LIMIT 1`,
            [booking.course_event_id]
          );
          const [firstDateRows] = await connection.query(
            `SELECT event_date
             FROM course_event_dates
             WHERE course_event_id = ?
               AND event_date > '1900-01-01'
               AND event_date NOT IN ('1111-11-11', '0000-00-00')
             ORDER BY event_date ASC
             LIMIT 1`,
            [booking.course_event_id]
          );

          const courseInfo = {};
          if (courseRows[0]) courseInfo.course_abb = courseRows[0].course_abb;
          if (eventLocationRows[0]) courseInfo.location = eventLocationRows[0].location_name;
          if (firstDateRows[0]) courseInfo.event_date = firstDateRows[0].event_date;

          await connection.query(
            `UPDATE booking_payments SET isDelete = 1 WHERE booking_id = ?`,
            [booking.id]
          );

          const bookingRefValue = primaryAttendee.booking_ref || `1SRC${booking.id}`;
          const snapshot = phpSerialize({
            booking,
            attendee: primaryAttendee,
            course_info: courseInfo,
            cancelled_via: 'node-cleanup-cron',
            timeout_minutes: Number(timeoutMinutes),
          });

          await connection.query(
            `INSERT INTO deleted_bookings (booking_id, booking_ref, booking_data)
             VALUES (?, ?, ?)`,
            [booking.id, bookingRefValue, snapshot]
          );

          await connection.query(
            `INSERT INTO booking_update_history
               (booking_id, updated_by_admin_id, type, status, created, modified)
             VALUES (?, 0, 'deleted', ?, NOW(), NOW())`,
            [booking.id, `Auto-cleanup: unpaid timeout after ${timeoutMinutes} minutes`]
          );

          await connection.query(`DELETE FROM booking_attendees WHERE booking_id = ?`, [booking.id]);
          await connection.query(`DELETE FROM booking_attendees_dropdown WHERE booking_id = ?`, [booking.id]);
          await connection.query(`DELETE FROM bookings WHERE id = ?`, [booking.id]);

          await connection.commit();
          console.log(`[CLEANUP CRON] Archived + deleted booking ID: ${booking.id}`);
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
    cron.schedule('*/15 * * * *', () => {
      console.log('[CLEANUP CRON] Running scheduled cleanup...');
      this.cleanupUnpaidBookings();
    });

    console.log('[CLEANUP CRON] Scheduled to run every 15 minutes');
  }
}

module.exports = BookingCleanupCron;
