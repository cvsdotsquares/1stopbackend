// src/routes/bookings.js
const express = require('express');
const BookingController = require('../controllers/bookings');
const BookingValidation = require('../middleware/bookingValidation');
const BookingStatusManager = require('../middleware/bookingStatusManager');
const { authenticateToken } = require('../middleware/auth');

function createBookingRoutes(pool) {
  const router = express.Router();
  const bookingController = new BookingController(pool);

  // Middleware to make pool available for validation
  router.use((req, res, next) => {
    req.app.locals.pool = pool;
    next();
  });

  /**
   * @route   POST /api/bookings
   * @desc    Create a new booking
   * @access  Private (authenticated users)
   */
  router.post('/',
    authenticateToken,
    BookingValidation.createBooking(),
    BookingValidation.validateBookingBusiness,
    (req, res) => bookingController.createBooking(req, res)
  );

  /**
   * @route   GET /api/bookings
   * @desc    Get user's bookings with optional filtering and pagination
   * @access  Private (authenticated users)
   */
  router.get('/',
    authenticateToken,
    BookingValidation.getUserBookings(),
    (req, res) => bookingController.getUserBookings(req, res)
  );

  /**
   * @route   GET /api/bookings/stats
   * @desc    Get user's booking statistics
   * @access  Private (authenticated users)
   */
  router.get('/stats',
    authenticateToken,
    (req, res) => bookingController.getBookingStats(req, res)
  );

  /**
   * @route   GET /api/bookings/:id
   * @desc    Get booking by ID
   * @access  Private (authenticated users, own bookings or as attendee)
   */
  router.get('/:id',
    authenticateToken,
    BookingValidation.getBookingById(),
    (req, res) => bookingController.getBookingById(req, res)
  );

  /**
   * @route   GET /api/bookings/:id/confirmation/preview
   * @desc    Get booking confirmation HTML preview
   * @access  Private (authenticated users, own bookings or as attendee)
   */
  router.get('/:id/confirmation/preview',
    authenticateToken,
    BookingValidation.getBookingById(),
    (req, res) => bookingController.getBookingConfirmationPreview(req, res)
  );

  /**
   * @route   POST /api/bookings/:id/confirmation/send
   * @desc    Resend booking confirmation to self or forward to another email
   * @access  Private (authenticated users, own bookings or as attendee)
   */
  router.post('/:id/confirmation/send',
    authenticateToken,
    BookingValidation.getBookingById(),
    (req, res) => bookingController.sendBookingConfirmationEmail(req, res)
  );

  /**
   * @route   PUT /api/bookings/:id
   * @desc    Update booking details (notes, emergency contacts, etc.)
   * @access  Private (authenticated users, own bookings only)
   */
  router.put('/:id',
    authenticateToken,
    BookingValidation.updateBooking(),
    BookingValidation.validateBookingOwnership,
    BookingValidation.validateBookingModifiable,
    (req, res) => bookingController.updateBooking(req, res)
  );

  /**
   * @route   POST /api/bookings/:id/cancel
   * @desc    Cancel a booking
   * @access  Private (authenticated users, own bookings only)
   */
  router.post('/:id/cancel',
    authenticateToken,
    BookingValidation.cancelBooking(),
    BookingValidation.validateBookingOwnership,
    BookingValidation.validateBookingCancellable,
    (req, res) => bookingController.cancelBooking(req, res)
  );

  // Admin routes
  /**
   * @route   GET /api/bookings/admin/all
   * @desc    Get all bookings (admin only)
   * @access  Private (admin only)
   */
  router.get('/admin/all',
    authenticateToken,
    BookingValidation.validateAdminRole,
    BookingValidation.getAllBookings(),
    (req, res) => bookingController.getAllBookings(req, res)
  );

  /**
   * @route   PUT /api/bookings/admin/:id/status
   * @desc    Update booking status (admin only)
   * @access  Private (admin only)
   */
  router.put('/admin/:id/status',
    authenticateToken,
    BookingValidation.validateAdminRole,
    [
      BookingValidation.getBookingById()[0], // Reuse ID validation
      // Only the two safe in-row transitions are exposed via this endpoint:
      //   0 = pending payment
      //   1 = confirmed
      // Refund (2), move-out tombstone (5), and "real cancellation" (which is
      // actually a hard-delete + archive) are intentionally NOT writable here.
      // Those flows live in the legacy PHP admin or in the dedicated cancel
      // endpoint, because they require side effects (refundable=2, freeze
      // counters, deleted_bookings archive, etc.) this endpoint cannot
      // safely perform.
      require('express-validator').body('status')
        .isInt()
        .custom((value) => {
          const v = Number(value);
          if (v !== 0 && v !== 1) {
            throw new Error('Only status 0 (pending payment) or 1 (confirmed) can be set via this endpoint. Use the legacy admin for refund / delete / move.');
          }
          return true;
        })
    ],
    async (req, res) => {
      try {
        const { validationResult } = require('express-validator');
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({
            success: false,
            message: 'Validation errors',
            errors: errors.array()
          });
        }

        const { id } = req.params;
        const newStatus = parseInt(req.body.status, 10);

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
          const [currentBooking] = await connection.query(`
            SELECT 
              b.*,
              ce.booking_limit,
              ce.bookings_done,
              ce.current_locks
            FROM bookings b
            JOIN course_events ce ON b.course_event_id = ce.id
            WHERE b.id = ?
          `, [id]);

          if (currentBooking.length === 0) {
            throw new Error('Booking not found');
          }

          const booking = currentBooking[0];
          const oldStatus = booking.status;

          if (oldStatus === newStatus) {
            await connection.commit();
            return res.json({
              success: true,
              message: 'Booking status unchanged',
              data: { id, old_status: oldStatus, new_status: newStatus }
            });
          }

          if (oldStatus === BookingStatusManager.STATUS.REFUNDED) {
            throw new Error('This booking has been refunded and cannot be re-activated via this endpoint');
          }
          if (oldStatus === BookingStatusManager.STATUS.MOVED_OUT) {
            throw new Error('This booking is a moved-out tombstone and is read-only');
          }

          await connection.query(
            `UPDATE bookings SET status = ?, modified = NOW() WHERE id = ?`,
            [newStatus, id]
          );
          console.log(`[BOOKING STATUS] UPDATE bookings status=${newStatus} (${BookingStatusManager.getStatusText(newStatus)}) | source=routes/bookings.js (admin PUT /admin/:id/status) | booking_id=${id} | old_status=${oldStatus} (${BookingStatusManager.getStatusText(oldStatus)}) | admin_user_id=${req.user?.id || 0}`);

          const { lockChange, bookingChange } = BookingStatusManager.calculateSpaceChanges(
            oldStatus,
            newStatus,
            booking.spaces
          );
          if (lockChange !== 0 || bookingChange !== 0) {
            const { applyGroupSpaceDelta } = require('../utils/courseEventGroup');
            await applyGroupSpaceDelta(connection, booking.course_event_id, {
              lockDelta: lockChange,
              bookingsDoneDelta: bookingChange,
            });
          }

          await connection.query(
            `INSERT INTO booking_update_history
               (booking_id, updated_by_admin_id, type, status, created, modified)
             VALUES (?, ?, 'status_change', ?, NOW(), NOW())`,
            [
              booking.id,
              req.user.id || 0,
              `Status ${oldStatus} -> ${newStatus} (${BookingStatusManager.getStatusText(oldStatus)} -> ${BookingStatusManager.getStatusText(newStatus)})`,
            ]
          );

          await connection.commit();

          res.json({
            success: true,
            message: 'Booking status updated successfully',
            data: {
              id,
              old_status: oldStatus,
              new_status: newStatus,
              old_status_text: BookingStatusManager.getStatusText(oldStatus),
              new_status_text: BookingStatusManager.getStatusText(newStatus),
            }
          });
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }

      } catch (error) {
        console.error('Error updating booking status:', error);
        res.status(500).json({
          success: false,
          message: error.message || 'Failed to update booking status',
          error: error.message
        });
      }
    }
  );

  /**
   * @route   GET /api/bookings/admin/statistics
   * @desc    Get comprehensive booking statistics (admin only)
   * @access  Private (admin only)
   */
  router.get('/admin/statistics',
    authenticateToken,
    BookingValidation.validateAdminRole,
    async (req, res) => {
      try {
        const { date_from, date_to } = req.query;
        
        let dateFilter = '';
        let queryParams = [];

        if (date_from || date_to) {
          if (date_from) {
            dateFilter += ' AND b.created >= ?';
            queryParams.push(date_from);
          }
          if (date_to) {
            dateFilter += ' AND b.created <= ?';
            queryParams.push(date_to + ' 23:59:59');
          }
        }

        // Status semantics (matches PHP):
        //   0 = pending payment, 1 = confirmed, 2 = refunded, 5 = moved-out tombstone.
        // Cancellations are hard-deleted from `bookings` and live in `deleted_bookings`,
        // so they are counted from there.
        const [overallStats] = await pool.query(`
          SELECT 
            COUNT(*) as total_bookings,
            COUNT(CASE WHEN status = 0 THEN 1 END) as pending_bookings,
            COUNT(CASE WHEN status = 1 THEN 1 END) as confirmed_bookings,
            COUNT(CASE WHEN status = 2 THEN 1 END) as refunded_bookings,
            COUNT(CASE WHEN status = 5 THEN 1 END) as moved_bookings,
            SUM(total_amount) as total_revenue,
            AVG(total_amount) as average_booking_value,
            SUM(spaces) as total_spaces_booked
          FROM bookings b
          WHERE (b.status <> 5 OR b.status IS NULL) ${dateFilter}
        `, queryParams);

        const [cancelledTotalRows] = await pool.query(`
          SELECT COUNT(*) as cancelled_bookings
          FROM deleted_bookings db
          WHERE 1 = 1 ${date_from || date_to ? "AND db.created BETWEEN COALESCE(?, '1900-01-01') AND COALESCE(?, '9999-12-31')" : ''}
        `, (date_from || date_to) ? [date_from || null, date_to ? `${date_to} 23:59:59` : null] : []);
        if (cancelledTotalRows[0]) {
          overallStats[0].cancelled_bookings = cancelledTotalRows[0].cancelled_bookings;
        }

        const [monthlyStats] = await pool.query(`
          SELECT 
            DATE_FORMAT(b.created, '%Y-%m') as month,
            COUNT(*) as bookings_count,
            SUM(total_amount) as revenue,
            COUNT(CASE WHEN status = 1 THEN 1 END) as confirmed_count,
            COUNT(CASE WHEN status = 2 THEN 1 END) as refunded_count
          FROM bookings b
          WHERE b.created >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            AND (b.status <> 5 OR b.status IS NULL)
          GROUP BY DATE_FORMAT(b.created, '%Y-%m')
          ORDER BY month DESC
        `);

        // Top courses by bookings
        const [topCourses] = await pool.query(`
          SELECT 
            c.id,
            c.course_name,
            c.course_abb,
            COUNT(b.id) as booking_count,
            SUM(b.total_amount) as total_revenue
          FROM bookings b
          JOIN courses c ON b.course_id = c.id
          WHERE 1=1 ${dateFilter}
          GROUP BY c.id, c.course_name, c.course_abb
          ORDER BY booking_count DESC
          LIMIT 10
        `, queryParams);

        // Recent bookings trend (last 30 days)
        const [recentTrend] = await pool.query(`
          SELECT 
            DATE(b.created) as date,
            COUNT(*) as bookings_count,
            SUM(b.total_amount) as daily_revenue
          FROM bookings b
          WHERE b.created >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          GROUP BY DATE(b.created)
          ORDER BY date DESC
        `);

        res.json({
          success: true,
          data: {
            overall: overallStats[0],
            monthly: monthlyStats,
            top_courses: topCourses,
            recent_trend: recentTrend
          }
        });

      } catch (error) {
        console.error('Error fetching booking statistics:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch booking statistics',
          error: error.message
        });
      }
    }
  );

  return router;
}

module.exports = createBookingRoutes;