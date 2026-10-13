function trim(value) {
  return value == null ? '' : String(value).trim();
}

const DEFAULT_LIMIT = 25;

async function listIpLogs(pool, {
  page = 1,
  limit = DEFAULT_LIMIT,
  search = '',
  status = '',
  blocked = '',
  sort = 'id',
  order = 'DESC',
} = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const take = Math.min(100, Math.max(1, Number(limit) || DEFAULT_LIMIT));
  const offset = (pageNum - 1) * take;

  const conditions = ['1=1'];
  const params = [];
  const searchTerm = trim(search);

  if (searchTerm) {
    conditions.push('(l.ip_address LIKE ? OR CAST(l.lock_session_id AS CHAR) LIKE ?)');
    params.push(`%${searchTerm}%`, `%${searchTerm}%`);
  }

  const validStatuses = ['pending', 'failed', 'success'];
  const statusFilter = trim(status).toLowerCase();
  if (statusFilter && validStatuses.includes(statusFilter)) {
    conditions.push('l.booking_status = ?');
    params.push(statusFilter);
  }

  const blockedFilter = trim(blocked).toLowerCase();
  if (blockedFilter === '1' || blockedFilter === 'true' || blockedFilter === 'blocked') {
    conditions.push('b.id IS NOT NULL');
  } else if (blockedFilter === '0' || blockedFilter === 'false' || blockedFilter === 'unblocked') {
    conditions.push('b.id IS NULL');
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const countSql = `
    SELECT COUNT(*) AS total
    FROM ip_logs l
    LEFT JOIN blocked_ips b 
      ON b.ip_address = l.ip_address 
      AND (b.blocked_until IS NULL OR b.blocked_until > NOW())
    ${whereClause}
  `;

  const [[countRow]] = await pool.query(countSql, params);
  const total = Number(countRow?.total) || 0;

  const validSortCols = {
    id: 'l.id',
    ip_address: 'l.ip_address',
    booking_status: 'l.booking_status',
    lock_session_id: 'l.lock_session_id',
    created_at: 'l.created_at',
  };
  const sortCol = validSortCols[sort] || 'l.id';
  const sortOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const dataSql = `
    SELECT 
      l.id,
      l.ip_address,
      l.booking_status,
      l.lock_session_id,
      l.created_at,
      CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END AS is_blocked,
      b.id AS blocked_id,
      b.blocked_until,
      b.created_at AS blocked_created_at
    FROM ip_logs l
    LEFT JOIN blocked_ips b 
      ON b.ip_address = l.ip_address 
      AND (b.blocked_until IS NULL OR b.blocked_until > NOW())
    ${whereClause}
    ORDER BY ${sortCol} ${sortOrder}
    LIMIT ?, ?
  `;

  const [rows] = await pool.query(dataSql, [...params, offset, take]);

  return {
    items: rows || [],
    pagination: {
      page: pageNum,
      perPage: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
    filters: {
      search: searchTerm,
      status: statusFilter,
      blocked: blockedFilter,
    },
  };
}

async function listBlockedIps(pool, {
  page = 1,
  limit = DEFAULT_LIMIT,
  search = '',
} = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const take = Math.min(100, Math.max(1, Number(limit) || DEFAULT_LIMIT));
  const offset = (pageNum - 1) * take;

  const conditions = ['1=1'];
  const params = [];
  const searchTerm = trim(search);

  if (searchTerm) {
    conditions.push('ip_address LIKE ?');
    params.push(`%${searchTerm}%`);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const countSql = `SELECT COUNT(*) AS total FROM blocked_ips ${whereClause}`;
  const [[countRow]] = await pool.query(countSql, params);
  const total = Number(countRow?.total) || 0;

  const dataSql = `
    SELECT 
      id,
      ip_address,
      blocked_until,
      created_at,
      TIMESTAMPDIFF(MINUTE, NOW(), blocked_until) AS minutes_remaining,
      CASE WHEN blocked_until IS NULL OR blocked_until > NOW() THEN 1 ELSE 0 END AS is_currently_active
    FROM blocked_ips
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ?, ?
  `;

  const [rows] = await pool.query(dataSql, [...params, offset, take]);

  return {
    items: rows || [],
    pagination: {
      page: pageNum,
      perPage: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
    filters: { search: searchTerm },
  };
}

async function getIpStats(pool) {
  const [[logStats]] = await pool.query(`
    SELECT 
      COUNT(*) AS total_logs,
      SUM(CASE WHEN booking_status = 'pending' THEN 1 ELSE 0 END) AS pending_logs,
      SUM(CASE WHEN booking_status = 'failed' THEN 1 ELSE 0 END) AS failed_logs,
      SUM(CASE WHEN booking_status = 'success' THEN 1 ELSE 0 END) AS success_logs
    FROM ip_logs
  `);

  const [[blockedStats]] = await pool.query(`
    SELECT COUNT(*) AS total_blocked
    FROM blocked_ips
    WHERE blocked_until IS NULL OR blocked_until > NOW()
  `);

  return {
    totalLogs: Number(logStats?.total_logs) || 0,
    pendingLogs: Number(logStats?.pending_logs) || 0,
    failedLogs: Number(logStats?.failed_logs) || 0,
    successLogs: Number(logStats?.success_logs) || 0,
    totalBlockedIps: Number(blockedStats?.total_blocked) || 0,
  };
}

async function unblockIp(pool, { ip_address, ip_id } = {}) {
  const ip = trim(ip_address);
  const id = ip_id ? Number(ip_id) : null;

  if (!ip && !id) {
    return { ok: false, message: 'IP address or block ID required' };
  }

  let targetIp = ip;

  if (!targetIp && id) {
    const [[row]] = await pool.query('SELECT ip_address FROM blocked_ips WHERE id = ?', [id]);
    if (row?.ip_address) {
      targetIp = row.ip_address;
    }
  }

  // 1. Delete from blocked_ips
  if (id && targetIp) {
    await pool.query('DELETE FROM blocked_ips WHERE id = ? OR ip_address = ?', [id, targetIp]);
  } else if (id) {
    await pool.query('DELETE FROM blocked_ips WHERE id = ?', [id]);
  } else if (targetIp) {
    await pool.query('DELETE FROM blocked_ips WHERE ip_address = ?', [targetIp]);
  }

  // 2. Delete from ip_logs where ip_address matches (legacy parity behavior)
  if (targetIp) {
    await pool.query('DELETE FROM ip_logs WHERE ip_address = ?', [targetIp]);
  }

  return {
    ok: true,
    message: targetIp ? `IP ${targetIp} unblocked and logs cleared` : 'Unblocked successfully',
    ip_address: targetIp,
  };
}

async function blockIp(pool, { ip_address, hours = 24 } = {}) {
  const ip = trim(ip_address);
  if (!ip) {
    return { ok: false, message: 'Valid IP address required' };
  }

  const durationHours = Math.max(1, Math.min(8760, Number(hours) || 24));

  const [[existing]] = await pool.query(
    'SELECT id FROM blocked_ips WHERE ip_address = ? LIMIT 1',
    [ip]
  );

  if (existing) {
    await pool.query(`
      UPDATE blocked_ips 
      SET blocked_until = DATE_ADD(NOW(), INTERVAL ? HOUR), created_at = NOW()
      WHERE id = ?
    `, [durationHours, existing.id]);
  } else {
    await pool.query(`
      INSERT INTO blocked_ips (ip_address, blocked_until, created_at)
      VALUES (?, DATE_ADD(NOW(), INTERVAL ? HOUR), NOW())
    `, [ip, durationHours]);
  }

  return {
    ok: true,
    message: `IP ${ip} blocked for ${durationHours} hour${durationHours > 1 ? 's' : ''}`,
    ip_address: ip,
    hours: durationHours,
  };
}

async function deleteIpLog(pool, id) {
  const numId = Number(id);
  if (!numId) return { ok: false, message: 'Invalid log ID' };

  const [result] = await pool.query('DELETE FROM ip_logs WHERE id = ?', [numId]);
  if (result.affectedRows === 0) {
    return { ok: false, message: 'Log entry not found' };
  }
  return { ok: true, message: 'Log entry deleted successfully' };
}

async function deleteIpLogsByIp(pool, ip_address) {
  const ip = trim(ip_address);
  if (!ip) return { ok: false, message: 'IP address required' };

  const [result] = await pool.query('DELETE FROM ip_logs WHERE ip_address = ?', [ip]);
  return {
    ok: true,
    message: `Deleted ${result.affectedRows} log entries for IP ${ip}`,
    affectedRows: result.affectedRows,
  };
}

module.exports = {
  listIpLogs,
  listBlockedIps,
  getIpStats,
  unblockIp,
  blockIp,
  deleteIpLog,
  deleteIpLogsByIp,
};
