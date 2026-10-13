const {
  listIpLogs,
  listBlockedIps,
  getIpStats,
  unblockIp,
  blockIp,
  deleteIpLog,
  deleteIpLogsByIp,
} = require('../services/ipLogsService');

class IpLogsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listIpLogs(this.pool, {
        page: req.query.page,
        limit: req.query.limit,
        search: req.query.search || req.query.ip_address || '',
        status: req.query.status || req.query.booking_status || '',
        blocked: req.query.blocked || '',
        sort: req.query.sort,
        order: req.query.order,
      });

      const stats = await getIpStats(this.pool);

      return res.json({
        success: true,
        data: {
          ...data,
          stats,
        },
      });
    } catch (err) {
      console.error('[ADMIN][IP_LOGS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load IP logs',
      });
    }
  }

  async listBlocked(req, res) {
    try {
      const data = await listBlockedIps(this.pool, {
        page: req.query.page,
        limit: req.query.limit,
        search: req.query.search || '',
      });
      const stats = await getIpStats(this.pool);
      return res.json({ success: true, data: { ...data, stats } });
    } catch (err) {
      console.error('[ADMIN][IP_LOGS][BLOCKED]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load blocked IPs',
      });
    }
  }

  async getStats(req, res) {
    try {
      const stats = await getIpStats(this.pool);
      return res.json({ success: true, data: stats });
    } catch (err) {
      console.error('[ADMIN][IP_LOGS][STATS]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load IP statistics',
      });
    }
  }

  async unblock(req, res) {
    try {
      const ip_address = req.body?.ip_address || req.query?.ip_address;
      const ip_id = req.body?.ip_id || req.body?.id || req.query?.ip_id;

      const result = await unblockIp(this.pool, { ip_address, ip_id });
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      // If client requests raw text (legacy release_ip.php), support text/plain response
      if (req.accepts('text/html', 'text/plain') && !req.is('json') && req.headers['x-requested-with'] !== 'XMLHttpRequest' && req.query?.format === 'text') {
        return res.send('OK');
      }

      return res.json({
        success: true,
        message: result.message,
        data: { ip_address: result.ip_address },
      });
    } catch (err) {
      console.error('[ADMIN][IP_LOGS][UNBLOCK]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error unblocking IP',
      });
    }
  }

  async block(req, res) {
    try {
      const { ip_address, hours } = req.body || {};
      const result = await blockIp(this.pool, { ip_address, hours });
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err) {
      console.error('[ADMIN][IP_LOGS][BLOCK]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error blocking IP',
      });
    }
  }

  async deleteLog(req, res) {
    try {
      const result = await deleteIpLog(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error('[ADMIN][IP_LOGS][DELETE_LOG]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error deleting log entry',
      });
    }
  }

  async deleteLogsByIp(req, res) {
    try {
      const result = await deleteIpLogsByIp(this.pool, req.params.ip);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
      return res.json({
        success: true,
        message: result.message,
        data: { affectedRows: result.affectedRows },
      });
    } catch (err) {
      console.error('[ADMIN][IP_LOGS][DELETE_LOGS_BY_IP]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error deleting logs for IP',
      });
    }
  }
}

module.exports = IpLogsController;
