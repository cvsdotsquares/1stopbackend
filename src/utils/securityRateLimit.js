const ACTION_LIMITS = {
  contact_form: { maxAttempts: 3, windowSeconds: 600, blockSeconds: 3600 },
  password_reset: { maxAttempts: 3, windowSeconds: 900, blockSeconds: 3600 },
  register: { maxAttempts: 5, windowSeconds: 900, blockSeconds: 3600 },
  login: { maxAttempts: 5, windowSeconds: 900, blockSeconds: 900 },
  verify_otp: { maxAttempts: 8, windowSeconds: 900, blockSeconds: 900 },
  auth_lookup: { maxAttempts: 20, windowSeconds: 900, blockSeconds: 900 },
  abuse: { maxAttempts: 1, windowSeconds: 86400, blockSeconds: 86400 },
};

function envInt(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getLimits(actionType) {
  const defaults = ACTION_LIMITS[actionType] || ACTION_LIMITS.auth_lookup;
  const key = actionType.toUpperCase();
  return {
    maxAttempts: envInt(`RATE_LIMIT_${key}_MAX`, defaults.maxAttempts),
    windowSeconds: envInt(`RATE_LIMIT_${key}_WINDOW_SEC`, defaults.windowSeconds),
    blockSeconds: envInt(`RATE_LIMIT_${key}_BLOCK_SEC`, defaults.blockSeconds),
  };
}

function toUnix(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'bigint') return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function remainingSeconds(blockedUnix, nowUnix) {
  if (blockedUnix == null || nowUnix == null) return 1;
  return Math.max(1, Math.floor(blockedUnix - nowUnix));
}

// Timer UIs hit 0:00 a second or two before MySQL; treat that as expired
// so the first retry is allowed instead of starting a new cooldown.
const BLOCK_GRACE_SECONDS = 2;

async function isIpBlocked(pool, ip, actionType) {
  const [rows] = await pool.query(
    `SELECT
        action_type,
        blocked_until,
        UNIX_TIMESTAMP(NOW()) AS now_unix,
        UNIX_TIMESTAMP(blocked_until) AS blocked_unix
     FROM security_rate_limits
     WHERE ip_address = ?
       AND blocked_until > DATE_ADD(NOW(), INTERVAL ? SECOND)
       AND action_type IN (?, 'abuse')
     LIMIT 1`,
    [ip, BLOCK_GRACE_SECONDS, actionType]
  );
  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    retry_after: remainingSeconds(toUnix(row.blocked_unix), toUnix(row.now_unix)),
  };
}

async function consumeOnce(pool, ip, actionType, limits) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT
          id,
          attempts,
          blocked_until,
          UNIX_TIMESTAMP(NOW()) AS now_unix,
          UNIX_TIMESTAMP(first_attempt_at) AS first_unix,
          UNIX_TIMESTAMP(blocked_until) AS blocked_unix
       FROM security_rate_limits
       WHERE ip_address = ? AND action_type = ?
       FOR UPDATE`,
      [ip, actionType]
    );

    if (rows.length === 0) {
      await conn.query(
        `INSERT INTO security_rate_limits
           (ip_address, action_type, attempts, first_attempt_at, last_attempt_at, blocked_until)
         VALUES (?, ?, 1, NOW(), NOW(), NULL)`,
        [ip, actionType]
      );
      await conn.commit();
      return { allowed: true, remaining: limits.maxAttempts - 1 };
    }

    const row = rows[0];
    const nowUnix = toUnix(row.now_unix) || 0;
    const firstUnix = toUnix(row.first_unix) || 0;
    const blockedUnix = toUnix(row.blocked_unix);
    const attempts = Math.max(0, toUnix(row.attempts) || 0);

    // Still serving a cooldown — return the remaining time, do not start a new hour.
    if (blockedUnix != null && blockedUnix > nowUnix + BLOCK_GRACE_SECONDS) {
      await conn.commit();
      return {
        allowed: false,
        retryAfterSeconds: remainingSeconds(blockedUnix, nowUnix),
        blockedUntil: row.blocked_until,
      };
    }

    const windowExpired = firstUnix < nowUnix - limits.windowSeconds;
    const blockExpired = blockedUnix != null && blockedUnix <= nowUnix + BLOCK_GRACE_SECONDS;

    // Fresh window after the previous cooldown or time window. The request
    // that comes in after waiting must be allowed — never re-block it.
    if (windowExpired || blockExpired) {
      await conn.query(
        `UPDATE security_rate_limits
         SET attempts = 1, first_attempt_at = NOW(), last_attempt_at = NOW(), blocked_until = NULL
         WHERE id = ?`,
        [row.id]
      );
      await conn.commit();
      return { allowed: true, remaining: limits.maxAttempts - 1 };
    }

    const nextAttempts = attempts + 1;
    const exceeded = nextAttempts > limits.maxAttempts;

    if (exceeded) {
      await conn.query(
        `UPDATE security_rate_limits
         SET attempts = ?, last_attempt_at = NOW(), blocked_until = DATE_ADD(NOW(), INTERVAL ? SECOND)
         WHERE id = ?`,
        [nextAttempts, limits.blockSeconds, row.id]
      );
      await conn.commit();
      return {
        allowed: false,
        retryAfterSeconds: limits.blockSeconds,
      };
    }

    await conn.query(
      `UPDATE security_rate_limits
       SET attempts = ?, last_attempt_at = NOW(), blocked_until = NULL
       WHERE id = ?`,
      [nextAttempts, row.id]
    );
    await conn.commit();
    return { allowed: true, remaining: Math.max(0, limits.maxAttempts - nextAttempts) };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function consume(pool, ip, actionType) {
  const limits = getLimits(actionType);

  const existingBlock = await isIpBlocked(pool, ip, actionType);
  if (existingBlock) {
    return {
      allowed: false,
      retryAfterSeconds: existingBlock.retry_after || limits.blockSeconds,
      blockedUntil: existingBlock.blocked_until,
    };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await consumeOnce(pool, ip, actionType, limits);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' && attempt === 0) continue;
      throw error;
    }
  }

  return { allowed: true, remaining: 0 };
}

async function block(pool, ip, actionType, blockSeconds) {
  const duration = blockSeconds || getLimits(actionType).blockSeconds;
  await pool.query(
    `INSERT INTO security_rate_limits
       (ip_address, action_type, attempts, first_attempt_at, last_attempt_at, blocked_until)
     VALUES (?, ?, 1, NOW(), NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))
     ON DUPLICATE KEY UPDATE
       attempts = attempts + 1,
       last_attempt_at = NOW(),
       blocked_until = DATE_ADD(NOW(), INTERVAL ? SECOND)`,
    [ip, actionType, duration, duration]
  );
}

async function reset(pool, ip, actionType) {
  await pool.query(
    `UPDATE security_rate_limits
     SET attempts = 0, first_attempt_at = NOW(), last_attempt_at = NOW(), blocked_until = NULL
     WHERE ip_address = ? AND action_type = ?`,
    [ip, actionType]
  );
}

module.exports = {
  ACTION_LIMITS,
  getLimits,
  consume,
  reset,
  block,
  isIpBlocked,
};
