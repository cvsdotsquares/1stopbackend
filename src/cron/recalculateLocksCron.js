const cron = require('node-cron');

/**
 * Reconcile course_events.current_locks against active lock_bookings rows.
 * Mirrors legacy admin/cron/remove_current_lock.php
 */
class RecalculateLocksCron {
  constructor(pool) {
    this.pool = pool;
  }

  async recalculateLocks() {
    try {
      console.log('[RECALCULATE LOCKS CRON] Checking current_locks against lock_bookings...');

      const [result] = await this.pool.query(
        `UPDATE course_events ce
         LEFT JOIN (
           SELECT event_id, SUM(space_required) AS total
           FROM lock_bookings
           WHERE (delete_process = 0 OR delete_process IS NULL)
           GROUP BY event_id
         ) lb ON lb.event_id = ce.id
         SET ce.current_locks = COALESCE(lb.total, 0)
         WHERE ce.current_locks != COALESCE(lb.total, 0)`
      );

      const changedRows = result?.affectedRows || 0;
      if (changedRows > 0) {
        console.log(`[RECALCULATE LOCKS CRON] Reconciled current_locks for ${changedRows} course_event(s)`);
      } else {
        console.log('[RECALCULATE LOCKS CRON] All course_events.current_locks are in sync');
      }
    } catch (error) {
      console.error('[RECALCULATE LOCKS CRON] Error reconciling current_locks:', error);
    }
  }

  start() {
    // Run every 15 minutes
    cron.schedule('*/15 * * * *', () => {
      this.recalculateLocks();
    });

    console.log('[RECALCULATE LOCKS CRON] Scheduled to run every 15 minutes');
  }
}

module.exports = RecalculateLocksCron;
