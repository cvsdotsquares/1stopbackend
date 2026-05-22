const cron = require('node-cron');
const { sendDeveloperAlert } = require('../utils/emailService');

/**
 * Mirrors 1stop-php/admin/cron/automatic_remove_space.php
 * - Pass 1: ride2 locks expired by LOCK_EXPIRE_API_MINUTES (default 20)
 * - Per lock: delete, then for each course_event with same parent update manual_lock_done, automatic_lock_done, current_locks
 */
class ExpiredLockCleanupCron {
  constructor(pool) {
    this.pool = pool;
  }

  async cleanupExpiredLocks() {
    const connection = await this.pool.getConnection();
    const apiExpiryMinutes = Number(process.env.LOCK_EXPIRE_API_MINUTES || 20);

    try {
      console.log(
        `[LOCK CLEANUP CRON] Starting cleanup: API expiry = ${apiExpiryMinutes} min...`
      );

      await connection.beginTransaction();

      const [rideTerminalLocks] = await connection.query(
        `SELECT
            id,
            parent,
            COALESCE(space_required, 1) AS space_required,
            COALESCE(manual_lock, 0) AS manual_lock,
            COALESCE(automatic_lock, 0) AS automatic_lock,
            locked_by
        FROM lock_bookings
        WHERE created <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
          AND locked_by = 'ride2'
        FOR UPDATE`,
        [apiExpiryMinutes]
      );

      let locksToProcess = rideTerminalLocks;

      if (!locksToProcess || locksToProcess.length === 0) {
        await connection.commit();
        console.log('[LOCK CLEANUP CRON] No expired locks found (ride2)');
        return;
      }

      let deletedCount = 0;
      let eventRowsTouched = 0;

      for (const lock of locksToProcess) {
        console.log('[LOCK CLEANUP CRON] Deleting lock:', lock.id);
        console.log('[LOCK CLEANUP CRON] Lock Data:', JSON.stringify(lock));
        const [deleteResult] = await connection.query('DELETE FROM lock_bookings WHERE id = ?', [lock.id]);
        console.log('[LOCK CLEANUP CRON] Delete result:', deleteResult);

        const mailOptions = {
          to: 'tiwari.sagar@dotsquares.com',
          subject: 'Expired lock cleanup',
          html: `<p>Expired lock cleanup</p>
          <p>Lock ID: ${lock.id}</p>
          <p>Delete result: ${JSON.stringify(deleteResult)}</p>
          <p>Locks to process: ${JSON.stringify(locksToProcess)}</p>`,
          text: `Expired lock cleanup
          Lock ID: ${lock.id}
          Delete result: ${JSON.stringify(deleteResult)}
          Locks to process: ${JSON.stringify(locksToProcess)}`
        };

        // Isolate email failures: SMTP issues must not roll back the cleanup
        // transaction. sendDeveloperAlert already swallows its own errors,
        // but we wrap defensively in case future changes throw.
        try {
          await sendDeveloperAlert(mailOptions);
          console.log('[LOCK CLEANUP CRON] Email sent to developer', mailOptions.to, mailOptions.subject);
        } catch (emailErr) {
          console.error('[LOCK CLEANUP CRON] Failed to send developer alert email:', emailErr);
        }
        console.log('[LOCK CLEANUP CRON] Deleted lock:', lock.id, 'with result:', deleteResult);
        if (!deleteResult || deleteResult.affectedRows === 0) {
          continue;
        }
        deletedCount += deleteResult.affectedRows;

        const [siblings] = await connection.query(
          'SELECT id, COALESCE(manual_lock_done, 0) AS manual_lock_done, COALESCE(automatic_lock_done, 0) AS automatic_lock_done FROM course_events WHERE parent = ?',
          [lock.parent]
        );

        for (const ev of siblings) {
          const newManual = Math.max(0, Number(ev.manual_lock_done) - Number(lock.manual_lock));
          const newAuto = Math.max(0, Number(ev.automatic_lock_done) - Number(lock.automatic_lock));

          await connection.query(
            'UPDATE course_events SET manual_lock_done = ?, automatic_lock_done = ? WHERE id = ?',
            [newManual, newAuto, ev.id]
          );
          eventRowsTouched += 1;

          await connection.query(
            'UPDATE course_events SET current_locks = GREATEST(0, current_locks - ?) WHERE id = ? AND current_locks > 0',
            [lock.space_required, ev.id]
          );
        }
      }

      await connection.commit();

      console.log(
        `[LOCK CLEANUP CRON] Deleted ${deletedCount} expired lock(s); updated course_events rows: ${eventRowsTouched} (manual/automatic; current_locks per sibling)`
      );
    } catch (error) {
      await connection.rollback();
      console.error('[LOCK CLEANUP CRON] Error during expired lock cleanup:', error);
    } finally {
      connection.release();
    }
    // create a log file in the logs folder
  }

  start() {
    cron.schedule('*/5 * * * *', () => {
      console.log('[LOCK CLEANUP CRON] Running scheduled expired lock cleanup...');
      this.cleanupExpiredLocks();
    });

    console.log('[LOCK CLEANUP CRON] Scheduled to run every 5 minutes');
  }
}

module.exports = ExpiredLockCleanupCron;
