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
        SELECT DISTINCT b.id, b.user_id, b.booking_made_by_id, b.course_event_id, b.total_amount, b.status, b.created, b.payment_due, b.admin_payment_received, b.type_of_book,
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

      const bookingsWithSecondary = await Promise.all((bookings || []).map(async (booking) => {
        const primaryUserId = booking.booking_made_by_id || booking.user_id;

        const [secondaryRows] = await this.pool.query(`
          SELECT
            b2.id as booking_id,
            b2.payment_due,
            b2.admin_payment_received,
            b2.total_fees,
            (
              SELECT ba2.booking_ref
              FROM booking_attendees ba2
              WHERE ba2.booking_id = b2.id
              ORDER BY ba2.\`primary\` DESC, ba2.id ASC
              LIMIT 1
            ) as booking_ref,
            (
              SELECT ba2.first_name
              FROM booking_attendees ba2
              WHERE ba2.booking_id = b2.id
              ORDER BY ba2.\`primary\` DESC, ba2.id ASC
              LIMIT 1
            ) as first_name,
            (
              SELECT ba2.sur_name
              FROM booking_attendees ba2
              WHERE ba2.booking_id = b2.id
              ORDER BY ba2.\`primary\` DESC, ba2.id ASC
              LIMIT 1
            ) as sur_name,
            (
              SELECT ba2.email
              FROM booking_attendees ba2
              WHERE ba2.booking_id = b2.id
              ORDER BY ba2.\`primary\` DESC, ba2.id ASC
              LIMIT 1
            ) as email
          FROM bookings b2
          WHERE b2.course_event_id = ?
            AND b2.booking_made_by_id = ?
            AND b2.user_id <> ?
            AND b2.id <> ?
          ORDER BY b2.id ASC
        `, [booking.course_event_id, primaryUserId, primaryUserId, booking.id]);

        return {
          ...booking,
          secondary_attendees: secondaryRows || []
        };
      }));

      // Status semantics (matches PHP):
      //   0 = pending payment, 1 = confirmed, 2 = refunded, 5 = moved-out tombstone.
      // "Completed" is derived from event dates: a booking is considered
      // completed when status=1 AND the latest course event date is in the past.
      // Moved-out tombstones (status=5) are excluded from totals to match
      // the PHP filter `(bookings.status != 5 OR bookings.status IS NULL)`.
      const [statsResult] = await this.pool.query(`
        SELECT
          COUNT(DISTINCT b.id) as total_bookings,
          COUNT(DISTINCT CASE WHEN b.status = 0 THEN b.id END) as pending_bookings,
          COUNT(DISTINCT CASE WHEN b.status = 1 THEN b.id END) as confirmed_bookings,
          COUNT(DISTINCT CASE WHEN b.status = 2 THEN b.id END) as refunded_bookings,
          COALESCE(SUM(DISTINCT b.total_amount), 0) as total_spent
        FROM bookings b
        LEFT JOIN booking_attendees ba ON b.id = ba.booking_id
        WHERE (b.user_id = ? OR ba.email = ?)
          AND (b.status <> 5 OR b.status IS NULL)
      `, [userId, req.user.email]);

      const [completedRows] = await this.pool.query(`
        SELECT COUNT(*) as completed_bookings FROM (
          SELECT b.id
          FROM bookings b
          LEFT JOIN booking_attendees ba ON b.id = ba.booking_id
          JOIN course_event_dates ced
            ON ced.course_event_id = b.course_event_id
           AND ced.event_date > '1900-01-01'
           AND ced.event_date NOT IN ('1111-11-11', '0000-00-00')
          WHERE (b.user_id = ? OR ba.email = ?)
            AND b.status = 1
          GROUP BY b.id
          HAVING MAX(ced.event_date) < CURDATE()
        ) sub
      `, [userId, req.user.email]);

      const stats = statsResult[0] || {
        total_bookings: 0,
        pending_bookings: 0,
        confirmed_bookings: 0,
        refunded_bookings: 0,
        total_spent: 0,
      };
      stats.completed_bookings = completedRows[0]?.completed_bookings ?? 0;

      // "Upcoming" = any booking whose event date is today or later, in any
      // non-COMPLETED / non-NO_SHOW state. We deliberately include CANCELLED
      // (status 3) and PENDING_PAYMENT (status 0) so the user can still see
      // bookings that were auto-cancelled (unpaid > 10 min) or are awaiting
      // payment for a future event. The frontend can render a status badge
      // off `b.status` when it needs to distinguish them visually.
      const [upcomingCourses] = await this.pool.query(`
        SELECT DISTINCT c.course_name, MIN(ced.event_date) as event_date, b.id as booking_id, b.user_id, b.booking_made_by_id, b.course_event_id,
               b.status, b.total_amount, b.payment_due, b.admin_payment_received, b.type_of_book, b.created,
               l.location_name, l.address1, l.address2, l.postcode, ba.first_name, ba.sur_name
        FROM bookings b
        JOIN courses c ON b.course_id = c.id
        JOIN course_events ce ON b.course_event_id = ce.id
        JOIN course_event_dates ced ON ce.id = ced.course_event_id
        JOIN locations l ON ce.location_id = l.id
        LEFT JOIN booking_attendees ba ON b.id = ba.booking_id
        WHERE (b.user_id = ? OR ba.email = ?)
          AND ced.event_date >= CURDATE()
          AND b.status NOT IN (2, 4)
        GROUP BY b.id, c.course_name, l.location_name, l.address1, l.address2, l.postcode
        ORDER BY event_date ASC
      `, [userId, req.user.email]);

      const upcomingWithSecondary = await Promise.all((upcomingCourses || []).map(async (course) => {
        const primaryUserId = course.booking_made_by_id || course.user_id;

        const [secondaryRows] = await this.pool.query(`
          SELECT
            b2.id as booking_id,
            b2.payment_due,
            b2.admin_payment_received,
            b2.total_fees,
            (
              SELECT ba2.booking_ref
              FROM booking_attendees ba2
              WHERE ba2.booking_id = b2.id
              ORDER BY ba2.\`primary\` DESC, ba2.id ASC
              LIMIT 1
            ) as booking_ref,
            (
              SELECT ba2.first_name
              FROM booking_attendees ba2
              WHERE ba2.booking_id = b2.id
              ORDER BY ba2.\`primary\` DESC, ba2.id ASC
              LIMIT 1
            ) as first_name,
            (
              SELECT ba2.sur_name
              FROM booking_attendees ba2
              WHERE ba2.booking_id = b2.id
              ORDER BY ba2.\`primary\` DESC, ba2.id ASC
              LIMIT 1
            ) as sur_name,
            (
              SELECT ba2.email
              FROM booking_attendees ba2
              WHERE ba2.booking_id = b2.id
              ORDER BY ba2.\`primary\` DESC, ba2.id ASC
              LIMIT 1
            ) as email
          FROM bookings b2
          WHERE b2.course_event_id = ?
            AND b2.booking_made_by_id = ?
            AND b2.user_id <> ?
            AND b2.id <> ?
          ORDER BY b2.id ASC
        `, [course.course_event_id, primaryUserId, primaryUserId, course.booking_id]);

        return {
          ...course,
          secondary_attendees: secondaryRows || []
        };
      }));

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
          recent_bookings: bookingsWithSecondary,
          upcoming_courses: upcomingWithSecondary,
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
