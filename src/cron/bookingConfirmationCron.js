const cron = require('node-cron');
const { sendAdminBookingConfirmationEmail } = require('../admin/services/adminBookingEmailService');

/**
 * Retries pending booking confirmation emails for completed SALE payments.
 * Mirrors legacy admin/cron/automatic_booking_confirmation.php
 */
class BookingConfirmationCron {
  constructor(pool) {
    this.pool = pool;
    this.isRunning = false;
  }

  async processPendingConfirmations() {
    if (this.isRunning) {
      console.log('[BOOKING CONFIRMATION CRON] Previous execution still running, skipping...');
      return;
    }

    this.isRunning = true;
    try {
      const [pendingPayments] = await this.pool.query(
        `SELECT id, booking_id, email_status
         FROM booking_payments
         WHERE email_status = 'no'
           AND payment_type = 'SALE'
           AND transation_id IS NOT NULL
           AND transation_id != ''
           AND (isDelete IS NULL OR isDelete = 0)
         ORDER BY id ASC
         LIMIT 50`
      );

      if (!pendingPayments || pendingPayments.length === 0) {
        return;
      }

      console.log(`[BOOKING CONFIRMATION CRON] Found ${pendingPayments.length} pending confirmation email(s)`);

      for (const row of pendingPayments) {
        const paymentId = Number(row.id);
        const bookingId = Number(row.booking_id);

        if (!bookingId || bookingId <= 0) {
          console.warn(`[BOOKING CONFIRMATION CRON] Skipping payment #${paymentId}: invalid booking_id`);
          continue;
        }

        try {
          const result = await sendAdminBookingConfirmationEmail(this.pool, bookingId, {
            resendMode: 13,
            logType: 'Booking Confirmation',
          });

          if (result?.sent) {
            await this.pool.query(
              "UPDATE booking_payments SET email_status = 'yes' WHERE id = ?",
              [paymentId]
            );
            console.log(
              `[BOOKING CONFIRMATION CRON] Confirmation sent for booking #${bookingId} (payment #${paymentId})`
            );
          } else {
            console.error(
              `[BOOKING CONFIRMATION CRON] Failed to send email for booking #${bookingId} (payment #${paymentId}):`,
              result?.reason || 'Unknown error'
            );
          }
        } catch (emailErr) {
          console.error(
            `[BOOKING CONFIRMATION CRON] Exception sending email for booking #${bookingId}:`,
            emailErr.message || emailErr
          );
        }
      }
    } catch (error) {
      console.error('[BOOKING CONFIRMATION CRON] Error in processPendingConfirmations:', error);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    // Run every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      this.processPendingConfirmations();
    });

    console.log('[BOOKING CONFIRMATION CRON] Scheduled to run every 5 minutes');
  }
}

module.exports = BookingConfirmationCron;
