const cron = require('node-cron');

/**
 * Mirrors 1stop-php/admin/cron/automatic_remove_space.php
 * - Pass 1: ride2/terminal locks expired by LOCK_EXPIRE_API_MINUTES (default 20)
 * - Pass 2: only if pass 1 is empty: online locks expired by LOCK_EXPIRE_ONLINE_MINUTES (default 10)
 * - Per lock: delete, then for each course_event with same parent update manual_lock_done, automatic_lock_done, current_locks
 */
class ExpiredLockCleanupCron {
  constructor(pool) {
    this.pool = pool;
  }

  async cleanupExpiredLocks() {
    const connection = await this.pool.getConnection();
    const apiExpiryMinutes = Number(process.env.LOCK_EXPIRE_API_MINUTES || 20);
    const onlineExpiryMinutes = Number(process.env.LOCK_EXPIRE_ONLINE_MINUTES || 10);

    try {
      console.log(
        `[LOCK CLEANUP CRON] Starting cleanup: API/terminal expiry = ${apiExpiryMinutes} min, online (pass 2) = ${onlineExpiryMinutes} min...`
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
          AND locked_by IN ('ride2', 'terminal')
        FOR UPDATE`,
        [apiExpiryMinutes]
      );

      let locksToProcess = rideTerminalLocks;
      if (!locksToProcess || locksToProcess.length === 0) {
        const [onlineLocks] = await connection.query(
          `SELECT
            id,
            parent,
            COALESCE(space_required, 1) AS space_required,
            COALESCE(manual_lock, 0) AS manual_lock,
            COALESCE(automatic_lock, 0) AS automatic_lock,
            locked_by
          FROM lock_bookings
          WHERE created <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
            AND locked_by = 'online'
          FOR UPDATE`,
          [onlineExpiryMinutes]
        );
        locksToProcess = onlineLocks;
      }

      if (!locksToProcess || locksToProcess.length === 0) {
        await connection.commit();
        console.log('[LOCK CLEANUP CRON] No expired locks found (ride2/terminal or online pass)');
        return;
      }

      let deletedCount = 0;
      let eventRowsTouched = 0;

      for (const lock of locksToProcess) {
        const [deleteResult] = await connection.query('DELETE FROM lock_bookings WHERE id = ?', [lock.id]);
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
