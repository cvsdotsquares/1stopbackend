// src/routes/bookings.js
const express = require('express');
const BookingController = require('../controllers/bookings');
const BookingValidation = require('../middleware/bookingValidation');
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
      require('express-validator').body('status')
        .isInt({ min: 0, max: 4 })
        .withMessage('Status must be between 0 and 4'),
      require('express-validator').body('admin_notes')
        .optional()
        .isLength({ max: 1000 })
        .withMessage('Admin notes must not exceed 1000 characters')
    ],
    async (req, res) => {
      // Custom admin status update logic
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
        const { status, admin_notes } = req.body;
        const admin_id = req.user.id;

        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
          // Get current booking
          const [currentBooking] = await connection.query(`
            SELECT 
              b.*,
              ce.event_date,
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
          const newStatus = parseInt(status);

          // Update booking status
          await connection.query(`
            UPDATE bookings 
            SET 
              status = ?,
              admin_notes = ?,
              modified = NOW(),
              status_changed_by = ?,
              status_changed_at = NOW()
            WHERE id = ?
          `, [newStatus, admin_notes || '', admin_id, id]);

          // Handle space allocation changes
          if (oldStatus !== newStatus) {
            let lockChange = 0;
            let bookingChange = 0;

            // From pending (0) to confirmed (1)
            if (oldStatus === 0 && newStatus === 1) {
              lockChange = -booking.spaces; // Release locks
              bookingChange = booking.spaces; // Add to bookings_done
            }
            // From confirmed (1) to pending (0)
            else if (oldStatus === 1 && newStatus === 0) {
              lockChange = booking.spaces; // Add to locks
              bookingChange = -booking.spaces; // Remove from bookings_done
            }
            // From pending (0) to cancelled/no-show (3,4)
            else if (oldStatus === 0 && (newStatus === 3 || newStatus === 4)) {
              lockChange = -booking.spaces; // Release locks
            }
            // From confirmed (1) to cancelled/no-show (3,4)
            else if (oldStatus === 1 && (newStatus === 3 || newStatus === 4)) {
              bookingChange = -booking.spaces; // Remove from bookings_done
            }
            // From cancelled/no-show back to pending
            else if ((oldStatus === 3 || oldStatus === 4) && newStatus === 0) {
              lockChange = booking.spaces; // Add to locks
            }
            // From cancelled/no-show back to confirmed
            else if ((oldStatus === 3 || oldStatus === 4) && newStatus === 1) {
              bookingChange = booking.spaces; // Add to bookings_done
            }

            // Apply changes to course_events
            if (lockChange !== 0 || bookingChange !== 0) {
              await connection.query(`
                UPDATE course_events 
                SET 
                  current_locks = GREATEST(0, current_locks + ?),
                  bookings_done = GREATEST(0, bookings_done + ?),
                  modified = NOW()
                WHERE id = ?
              `, [lockChange, bookingChange, booking.course_event_id]);
            }
          }

          await connection.commit();

          res.json({
            success: true,
            message: 'Booking status updated successfully',
            data: {
              id: id,
              old_status: oldStatus,
              new_status: newStatus,
              admin_notes: admin_notes
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

        // Overall statistics
        const [overallStats] = await pool.query(`
          SELECT 
            COUNT(*) as total_bookings,
            COUNT(CASE WHEN status = 0 THEN 1 END) as pending_bookings,
            COUNT(CASE WHEN status = 1 THEN 1 END) as confirmed_bookings,
            COUNT(CASE WHEN status = 2 THEN 1 END) as completed_bookings,
            COUNT(CASE WHEN status = 3 THEN 1 END) as cancelled_bookings,
            COUNT(CASE WHEN status = 4 THEN 1 END) as noshow_bookings,
            SUM(total_amount) as total_revenue,
            AVG(total_amount) as average_booking_value,
            SUM(spaces) as total_spaces_booked
          FROM bookings b
          WHERE 1=1 ${dateFilter}
        `, queryParams);

        // Monthly statistics for the last 12 months
        const [monthlyStats] = await pool.query(`
          SELECT 
            DATE_FORMAT(b.created, '%Y-%m') as month,
            COUNT(*) as bookings_count,
            SUM(total_amount) as revenue,
            COUNT(CASE WHEN status = 1 THEN 1 END) as confirmed_count,
            COUNT(CASE WHEN status = 3 THEN 1 END) as cancelled_count
          FROM bookings b
          WHERE b.created >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
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