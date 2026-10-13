const express = require('express');
const IpLogsController = require('../controllers/ipLogsController');
const { requireAdminSession } = require('../middleware/adminAuth');

function createIpLogsRoutes(pool) {
  const router = express.Router();
  const controller = new IpLogsController(pool);

  router.get('/', requireAdminSession, (req, res) => controller.list(req, res));
  router.get('/stats', requireAdminSession, (req, res) => controller.getStats(req, res));
  router.get('/blocked', requireAdminSession, (req, res) => controller.listBlocked(req, res));
  router.post('/block', requireAdminSession, (req, res) => controller.block(req, res));
  // Unblock allows without admin session for legacy release_ip.php parity, but also supports authenticated calls
  router.post('/unblock', (req, res) => controller.unblock(req, res));
  router.all('/release', (req, res) => controller.unblock(req, res));
  router.delete('/by-ip/:ip', requireAdminSession, (req, res) => controller.deleteLogsByIp(req, res));
  router.delete('/:id', requireAdminSession, (req, res) => controller.deleteLog(req, res));

  return router;
}

module.exports = createIpLogsRoutes;
