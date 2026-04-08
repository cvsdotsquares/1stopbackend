// src/controllers/dashboard.js
class DashboardController {
  constructor(pool) {
    this.pool = pool;
  }

  async getUserDashboard(req, res) {
    try {
      const userId = req.user.id;

      // Previous bookings
      const [bookings] = await this.pool.query(`
        SELECT DISTINCT b.id, b.total_amount, b.status, b.created, b.payment_due, b.admin_payment_received, b.type_of_book,
               c.course_name, MIN(ced.event_date) as event_date,
               l.location_name, l.address1, l.address2, l.postcode,
               bp.transation_id as transaction_id, ced.event_start_time, ba.first_name, ba.sur_name
        FROM bookings b
        JOIN courses c ON b.course_id = c.id
        JOIN course_events ce ON b.course_event_id = ce.id
        JOIN course_event_dates ced ON ce.id = ced.course_event_id and ced.event_date < CURDATE() and ced.event_date > '1900-01-01'
        JOIN locations l ON ce.location_id = l.id
        LEFT JOIN booking_payments bp ON b.id = bp.booking_id AND bp.payment_type = 'SALE'
        LEFT JOIN booking_attendees ba ON b.id = ba.booking_id
        WHERE (b.user_id = ? OR ba.email = ?)
        GROUP BY b.id, b.total_amount, b.status, b.created, c.course_name, l.location_name, l.address1, l.address2, l.postcode, bp.transation_id
        ORDER BY b.created DESC
        LIMIT 5
      `, [userId, req.user.email]);

      const [statsResult] = await this.pool.query(`
        SELECT
          COUNT(DISTINCT b.id) as total_bookings,
          COUNT(DISTINCT CASE WHEN b.status = 2 THEN b.id END) as completed_bookings,
          COUNT(DISTINCT CASE WHEN b.status = 1 THEN b.id END) as pending_bookings,
          COALESCE(SUM(DISTINCT b.total_amount), 0) as total_spent
        FROM bookings b
        LEFT JOIN booking_attendees ba ON b.id = ba.booking_id
        WHERE b.user_id = ? OR ba.email = ?
      `, [userId, req.user.email]);

      const stats = statsResult[0] || {
        total_bookings: 0,
        completed_bookings: 0,
        pending_bookings: 0,
        total_spent: 0
      };

      // Add confirmed bookings count
      stats.confirmed_bookings = stats.pending_bookings;

      const [upcomingCourses] = await this.pool.query(`
        SELECT DISTINCT c.course_name, MIN(ced.event_date) as event_date, b.id as booking_id,
               l.location_name, l.address1, l.address2, l.postcode
        FROM bookings b
        JOIN courses c ON b.course_id = c.id
        JOIN course_events ce ON b.course_event_id = ce.id
        JOIN course_event_dates ced ON ce.id = ced.course_event_id
        JOIN locations l ON ce.location_id = l.id
        LEFT JOIN booking_attendees ba ON b.id = ba.booking_id
        WHERE (b.user_id = ? OR ba.email = ?) AND ced.event_date >= CURDATE() AND b.status IN (0, 1)
        GROUP BY b.id, c.course_name, l.location_name, l.address1, l.address2, l.postcode
        ORDER BY event_date ASC
        LIMIT 3
      `, [userId, req.user.email]);

      const [giftVouchers] = await this.pool.query(`
        SELECT
          gv.id,
          gv.voucher_ref,
          gv.voucher_value,
          gv.subject as course_name,
          gv.voucher_person as recipient_name,
          gv.purchased_by,
          gv.voucher_email,
          gv.redeemed,
          gv.created as purchased_on,
          DATE_ADD(gv.created, INTERVAL 12 MONTH) as valid_till,
          CASE
            WHEN gv.user_id = ? THEN 'purchased'
            ELSE 'received'
          END as voucher_type,
          CASE
            WHEN LOWER(TRIM(COALESCE(gv.redeemed, 'No'))) = 'yes' THEN 'redeemed'
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
          stats: stats,
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
