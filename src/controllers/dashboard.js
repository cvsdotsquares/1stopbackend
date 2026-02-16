// src/controllers/dashboard.js
class DashboardController {
  constructor(pool) {
    this.pool = pool;
  }

  async getUserDashboard(req, res) {
    try {
      const userId = req.user.id;

      const [bookings] = await this.pool.query(`
        SELECT b.id, b.total_amount, b.status, b.created,
               c.course_name, MIN(ced.event_date) as event_date
        FROM bookings b
        JOIN courses c ON b.course_id = c.id
        JOIN course_events ce ON b.course_event_id = ce.id
        JOIN course_event_dates ced ON ce.id = ced.course_event_id
        WHERE b.user_id = ?
        GROUP BY b.id, b.total_amount, b.status, b.created, c.course_name
        ORDER BY b.created DESC
        LIMIT 5
      `, [userId]);

      const [stats] = await this.pool.query(`
        SELECT
          COUNT(*) as total_bookings,
          SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as completed_bookings,
          SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as pending_bookings,
          SUM(total_amount) as total_spent
        FROM bookings
        WHERE user_id = ?
      `, [userId]);

      const [upcomingCourses] = await this.pool.query(`
        SELECT c.course_name, MIN(ced.event_date) as event_date, b.id as booking_id,
               l.location_name, l.address1, l.address2, l.postcode
        FROM bookings b
        JOIN courses c ON b.course_id = c.id
        JOIN course_events ce ON b.course_event_id = ce.id
        JOIN course_event_dates ced ON ce.id = ced.course_event_id
        JOIN locations l ON ce.location_id = l.id
        WHERE b.user_id = ? AND ced.event_date >= CURDATE() AND b.status IN (0, 1)
        GROUP BY b.id, c.course_name, l.location_name, l.address1, l.address2, l.postcode
        ORDER BY event_date ASC
        LIMIT 3
      `, [userId]);

      const [giftVouchers] = await this.pool.query(`
        SELECT
          gv.id,
          gv.voucher_ref,
          gv.voucher_value,
          gv.subject as course_name,
          gv.voucher_person as recipient_name,
          gv.purchased_by,
          gv.voucher_email,
          gv.created as purchased_on,
          DATE_ADD(gv.created, INTERVAL 12 MONTH) as valid_till,
          CASE
            WHEN gv.user_id = ? THEN 'purchased'
            ELSE 'received'
          END as voucher_type,
          CASE
            WHEN gv.redeem_note != '' THEN 'redeemed'
            WHEN DATE_ADD(gv.created, INTERVAL 12 MONTH) < NOW() THEN 'expired'
            ELSE 'active'
          END as status
        FROM gift_voucher gv
        WHERE gv.user_id = ? OR gv.voucher_email = ?
        ORDER BY gv.created DESC
      `, [userId, userId, req.user.email]);

      res.json({
        success: true,
        data: {
          user: {
            id: req.user.id,
            name: `${req.user.first_name} ${req.user.sur_name}`,
            email: req.user.email
          },
          stats: stats[0],
          recent_bookings: bookings,
          upcoming_courses: upcomingCourses,
          gift_vouchers: giftVouchers
        }
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dashboard data'
      });
    }
  }
}

module.exports = DashboardController;
