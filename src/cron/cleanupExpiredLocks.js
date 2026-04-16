const cron = require('node-cron');

class ExpiredLockCleanupCron {
  constructor(pool) {
    this.pool = pool;
  }

  async cleanupExpiredLocks() {
    const connection = await this.pool.getConnection();

    try {
      const expiryMinutes = Number(process.env.LOCK_BOOKING_EXPIRY_MINUTES || 15);
      console.log(`[LOCK CLEANUP CRON] Starting cleanup of expired automatic locks older than ${expiryMinutes} minutes...`);

      await connection.beginTransaction();

      const [expiredLocks] = await connection.query(`
        SELECT id, event_id, parent, COALESCE(space_required, 1) AS space_required
        FROM lock_bookings
        WHERE created <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
          AND COALESCE(automatic_lock, 0) = 1
          AND COALESCE(manual_lock, 0) = 0
          AND COALESCE(payment_page_stauts, 0) = 1
        FOR UPDATE
      `, [expiryMinutes]);

      if (expiredLocks.length === 0) {
        await connection.commit();
        console.log('[LOCK CLEANUP CRON] No expired automatic locks found');
        return;
      }

      const expiredLockIds = expiredLocks.map((lock) => lock.id);
      const affectedEventIds = [...new Set(
        expiredLocks
          .map((lock) => Number(lock.event_id))
          .filter((eventId) => Number.isInteger(eventId) && eventId > 0)
      )];
      const affectedParents = [...new Set(
        expiredLocks
          .map((lock) => Number(lock.parent))
          .filter((parentId) => Number.isInteger(parentId) && parentId > 0)
      )];

      const affectedCourseEventIds = new Set(affectedEventIds);

      if (affectedParents.length > 0) {
        const [relatedCourseEvents] = await connection.query(
          'SELECT id FROM course_events WHERE parent IN (?)',
          [affectedParents]
        );

        for (const event of relatedCourseEvents) {
          affectedCourseEventIds.add(event.id);
        }
      }

      const [deleteResult] = await connection.query(
        'DELETE FROM lock_bookings WHERE id IN (?)',
        [expiredLockIds]
      );

      if (affectedCourseEventIds.size > 0) {
        await connection.query(`
          UPDATE course_events ce
          LEFT JOIN (
            SELECT parent, COALESCE(SUM(space_required), 0) AS total_parent_locks
            FROM lock_bookings
            WHERE parent IS NOT NULL AND parent <> 0
            GROUP BY parent
          ) parentLocks ON parentLocks.parent = ce.parent
          LEFT JOIN (
            SELECT event_id, COALESCE(SUM(space_required), 0) AS total_event_locks
            FROM lock_bookings
            WHERE parent IS NULL OR parent = 0
            GROUP BY event_id
          ) eventLocks ON eventLocks.event_id = ce.id
          SET ce.current_locks = GREATEST(
                0,
                COALESCE(parentLocks.total_parent_locks, 0) + COALESCE(eventLocks.total_event_locks, 0)
              ),
              ce.modified = NOW()
          WHERE ce.id IN (?)
        `, [[...affectedCourseEventIds]]);
      }

      await connection.commit();

      console.log(
        `[LOCK CLEANUP CRON] Deleted ${deleteResult.affectedRows} expired lock(s) and refreshed ${affectedCourseEventIds.size} course event row(s)`
      );
    } catch (error) {
      await connection.rollback();
      console.error('[LOCK CLEANUP CRON] Error during expired lock cleanup:', error);
    } finally {
      connection.release();
    }
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
