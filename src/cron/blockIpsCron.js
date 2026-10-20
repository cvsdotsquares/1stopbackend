const cron = require('node-cron');

/**
 * IP auto-blocking and expiration cron.
 * Mirrors legacy admin/cron/cron_block_ips.php:
 * 1. Block IPs with 3+ 'pending' attempts in ip_logs within the last 1 hour.
 * 2. Unblock IPs whose 24-hour ban period has elapsed.
 */
class BlockIpsCron {
  constructor(pool) {
    this.pool = pool;
  }

  async processBlockedIps() {
    try {
      // Step 1: Find abusive IPs with >= 3 pending attempts in the last 1 hour
      const [abusiveRows] = await this.pool.query(
        `SELECT ip_address, COUNT(*) AS attempt_count
         FROM ip_logs
         WHERE booking_status = 'pending'
           AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
           AND ip_address IS NOT NULL
           AND ip_address != ''
         GROUP BY ip_address
         HAVING attempt_count >= 3`
      );

      let blockedCount = 0;
      if (abusiveRows && abusiveRows.length > 0) {
        for (const row of abusiveRows) {
          const ip = String(row.ip_address).trim();
          if (!ip) continue;

          // Check if already in blocked_ips
          const [existing] = await this.pool.query(
            'SELECT id FROM blocked_ips WHERE ip_address = ? LIMIT 1',
            [ip]
          );

          if (!existing || existing.length === 0) {
            await this.pool.query(
              `INSERT INTO blocked_ips (ip_address, blocked_until, created_at)
               VALUES (?, DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW())`,
              [ip]
            );
            blockedCount++;
            console.log(`[BLOCK IPS CRON] Blocked IP ${ip} (attempts: ${row.attempt_count}) for 24 hours`);
          }
        }
      }

      // Step 2: Delete expired bans
      const [unblockResult] = await this.pool.query(
        'DELETE FROM blocked_ips WHERE blocked_until IS NOT NULL AND blocked_until <= NOW()'
      );
      const unblockedCount = unblockResult?.affectedRows || 0;

      if (blockedCount > 0 || unblockedCount > 0) {
        console.log(
          `[BLOCK IPS CRON] Run complete: ${blockedCount} newly blocked, ${unblockedCount} unblocked`
        );
      }
    } catch (error) {
      console.error('[BLOCK IPS CRON] Error processing IP blocks:', error);
    }
  }

  start() {
    // Run every 10 minutes
    cron.schedule('*/10 * * * *', () => {
      this.processBlockedIps();
    });

    console.log('[BLOCK IPS CRON] Scheduled to run every 10 minutes');
  }
}

module.exports = BlockIpsCron;
