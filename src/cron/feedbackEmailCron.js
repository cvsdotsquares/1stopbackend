const cron = require('node-cron');
const { sendAdminBookingFeedbackEmail } = require('../admin/services/adminBookingEmailService');

/**
 * Daily "Course Passed" feedback email cron.
 * Mirrors legacy admin/cron/itinary_feedback_email_cron.php
 */
class FeedbackEmailCron {
  constructor(pool) {
    this.pool = pool;
    this.isRunning = false;
  }

  async sendDailyPassedFeedbackEmails() {
    if (this.isRunning) {
      console.log('[FEEDBACK CRON] Previous execution still running, skipping...');
      return;
    }

    this.isRunning = true;
    try {
      console.log('[FEEDBACK CRON] Scanning for students who passed today...');

      const [passedStudents] = await this.pool.query(
        `SELECT DISTINCT
           b.id AS booking_id,
           ba.booking_ref,
           ba.email,
           ba.first_name,
           ba.sur_name,
           c.course_name
         FROM student_daily_report sdr
         JOIN bookings b ON sdr.booking_id = b.id
         JOIN courses c ON c.id = b.course_id
         JOIN booking_attendees ba ON ba.booking_id = b.id
         WHERE DATE(sdr.created) = CURDATE()
           AND sdr.report = 1
           AND b.status = 1
           AND IFNULL(b.on_hold, 0) = 0
           AND ba.email IS NOT NULL
           AND TRIM(ba.email) != ''`
      );

      if (!passedStudents || passedStudents.length === 0) {
        console.log('[FEEDBACK CRON] No passed students found for today');
        return;
      }

      console.log(`[FEEDBACK CRON] Found ${passedStudents.length} candidate(s) for feedback email`);

      let sentCount = 0;
      let skippedCount = 0;

      for (const row of passedStudents) {
        const bookingId = Number(row.booking_id);
        const bookingRef = String(row.booking_ref || '').trim();

        // Check if feedback email was already sent today (e.g. by instructor upon entering results)
        const [alreadySent] = await this.pool.query(
          `SELECT id FROM email_logs
           WHERE book_ref = ?
             AND type IN ('Course Passed', 'Feedback')
             AND DATE(created) = CURDATE()
           LIMIT 1`,
          [bookingRef]
        );

        if (alreadySent && alreadySent.length > 0) {
          skippedCount++;
          continue;
        }

        try {
          const result = await sendAdminBookingFeedbackEmail(this.pool, bookingId);
          if (result?.sent) {
            sentCount++;
            console.log(`[FEEDBACK CRON] Feedback email sent for booking #${bookingId} (${bookingRef})`);
          } else {
            console.log(
              `[FEEDBACK CRON] Feedback email not sent for booking #${bookingId} (${bookingRef}):`,
              result?.reason || 'Unknown reason'
            );
          }
        } catch (err) {
          console.error(
            `[FEEDBACK CRON] Error sending feedback email for booking #${bookingId}:`,
            err.message || err
          );
        }
      }

      console.log(
        `[FEEDBACK CRON] Run complete: ${sentCount} sent, ${skippedCount} already sent today`
      );
    } catch (error) {
      console.error('[FEEDBACK CRON] Error executing feedbackEmailCron:', error);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    // Run daily at 18:30 (6:30 PM)
    cron.schedule('30 18 * * *', () => {
      this.sendDailyPassedFeedbackEmails();
    });

    console.log('[FEEDBACK CRON] Scheduled to run daily at 18:30');
  }
}

module.exports = FeedbackEmailCron;
