// src/controllers/preBooking.js
class PreBookingController {
  constructor(pool) {
    this.pool = pool;
  }

  // Check if IP is blocked
  async checkIpBlock(req, res) {
    try {
      let { ip_address } = req.body;

      // Use server's detected IP if not provided or is localhost
      if (!ip_address || ip_address === '127.0.0.1' || ip_address === 'localhost') {
        ip_address = req.clientIp || req.ip;
      }

      if (!ip_address) {
        return res.status(400).json({ blocked: false, message: 'IP address required' });
      }

      const [blocked] = await this.pool.query(`
        SELECT COUNT(*) as count FROM blocked_ips
        WHERE ip_address = ? AND blocked_until > NOW()
      `, [ip_address]);

      if (blocked[0].count > 0) {
        return res.json({
          blocked: true,
          message: 'IP is currently blocked'
        });
      }

      res.json({ blocked: false });
    } catch (error) {
      console.error('Error checking IP block:', error);
      res.status(500).json({ blocked: false, message: 'Server error' });
    }
  }

   // Get course availability (NO LOCKS - only bookings_done)
  async getCourseAvailability(req, res) {
    try {
      const { eventId } = req.params;

      const [event] = await this.pool.query(`
        SELECT booking_limit, bookings_done FROM course_events WHERE id = ?
      `, [eventId]);

      if (!event.length) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const bookingLimit = event[0].booking_limit;
      const bookingsDone = event[0].bookings_done;
      const availableSpaces = Math.max(0, bookingLimit - bookingsDone);

      res.json({
        available_spaces: availableSpaces,
        booking_limit: bookingLimit,
        bookings_done: bookingsDone
      });
    } catch (error) {
      console.error('Error getting course availability:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }

  // Log IP activity
  async logIpActivity(req, res) {
    try {
      let { ip_address, lock_session_id, booking_status = 'pending' } = req.body;

      // Only use server IP if frontend didn't send any IP
      if (!ip_address) {
        let detectedIp = req.clientIp || req.ip || req.connection.remoteAddress;
        if (detectedIp === '::1' || detectedIp === '::ffff:127.0.0.1') {
          detectedIp = '127.0.0.1';
        }
        ip_address = detectedIp;
      }

      if (!ip_address || !lock_session_id) {
        return res.status(400).json({ logged: false, message: 'Missing required fields' });
      }

      // Check if already exists
      const [existing] = await this.pool.query(`
        SELECT COUNT(*) as count FROM ip_logs WHERE lock_session_id = ?
      `, [lock_session_id]);

      if (existing[0].count === 0) {
        await this.pool.query(`
          INSERT INTO ip_logs (ip_address, booking_status, lock_session_id, created_at)
          VALUES (?, ?, ?, NOW())
        `, [ip_address, booking_status, lock_session_id]);
      }

      res.json({ logged: true, ip_used: ip_address });
    } catch (error) {
      console.error('Error logging IP activity:', error);
      res.status(500).json({ logged: false, message: 'Server error' });
    }
  }
}

module.exports = PreBookingController;