// src/middleware/bookingValidation.js
const { body, param, query } = require('express-validator');

class BookingValidation {
  
  /**
   * Validation rules for creating a booking
   */
  static createBooking() {
    return [
      body('course_id')
        .isInt({ min: 1 })
        .withMessage('Course ID must be a positive integer'),
      
      body('course_event_id')
        .isInt({ min: 1 })
        .withMessage('Course event ID must be a positive integer'),
      
      body('spaces')
        .optional()
        .isInt({ min: 1, max: 10 })
        .withMessage('Spaces must be between 1 and 10'),
      
      body('customer_notes')
        .optional()
        .isLength({ max: 1000 })
        .withMessage('Customer notes must not exceed 1000 characters')
        .trim(),
      
      body('emergency_contact_name')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Emergency contact name must not exceed 100 characters')
        .trim(),
      
      body('emergency_contact_phone')
        .optional()
        .matches(/^[\d\s\+\-\(\)]{7,20}$/)
        .withMessage('Emergency contact phone must be a valid phone number')
        .trim(),
      
      body('special_requirements')
        .optional()
        .isLength({ max: 500 })
        .withMessage('Special requirements must not exceed 500 characters')
        .trim()
    ];
  }

  /**
   * Validation rules for updating a booking
   */
  static updateBooking() {
    return [
      param('id')
        .isInt({ min: 1 })
        .withMessage('Booking ID must be a positive integer'),
      
      body('customer_notes')
        .optional()
        .isLength({ max: 1000 })
        .withMessage('Customer notes must not exceed 1000 characters')
        .trim(),
      
      body('emergency_contact_name')
        .optional()
        .isLength({ max: 100 })
        .withMessage('Emergency contact name must not exceed 100 characters')
        .trim(),
      
      body('emergency_contact_phone')
        .optional()
        .matches(/^[\d\s\+\-\(\)]{7,20}$/)
        .withMessage('Emergency contact phone must be a valid phone number')
        .trim(),
      
      body('special_requirements')
        .optional()
        .isLength({ max: 500 })
        .withMessage('Special requirements must not exceed 500 characters')
        .trim()
    ];
  }

  /**
   * Validation rules for cancelling a booking
   */
  static cancelBooking() {
    return [
      param('id')
        .isInt({ min: 1 })
        .withMessage('Booking ID must be a positive integer'),
      
      body('cancellation_reason')
        .optional()
        .isLength({ max: 500 })
        .withMessage('Cancellation reason must not exceed 500 characters')
        .trim()
    ];
  }

  /**
   * Validation rules for getting booking by ID
   */
  static getBookingById() {
    return [
      param('id')
        .isInt({ min: 1 })
        .withMessage('Booking ID must be a positive integer')
    ];
  }

  /**
   * Validation rules for getting user bookings with query parameters
   */
  static getUserBookings() {
    return [
      query('status')
        .optional()
        .isIn(['all', '0', '1', '2', '3', '4'])
        .withMessage('Status must be: all, 0 (pending), 1 (confirmed), 2 (completed), 3 (cancelled), or 4 (no-show)'),
      
      query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),
      
      query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
      
      query('sort')
        .optional()
        .isIn(['created', 'modified', 'event_date', 'total_amount'])
        .withMessage('Sort field must be: created, modified, event_date, or total_amount'),
      
      query('order')
        .optional()
        .isIn(['ASC', 'DESC', 'asc', 'desc'])
        .withMessage('Order must be ASC or DESC')
    ];
  }

  /**
   * Validation rules for admin getting all bookings
   */
  static getAllBookings() {
    return [
      query('status')
        .optional()
        .isIn(['all', '0', '1', '2', '3', '4'])
        .withMessage('Status must be: all, 0 (pending), 1 (confirmed), 2 (completed), 3 (cancelled), or 4 (no-show)'),
      
      query('course_id')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Course ID must be a positive integer'),
      
      query('location_id')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Location ID must be a positive integer'),
      
      query('date_from')
        .optional()
        .isISO8601()
        .withMessage('Date from must be a valid date (YYYY-MM-DD)'),
      
      query('date_to')
        .optional()
        .isISO8601()
        .withMessage('Date to must be a valid date (YYYY-MM-DD)'),
      
      query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),
      
      query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
      
      query('search')
        .optional()
        .isLength({ min: 1, max: 100 })
        .withMessage('Search term must be between 1 and 100 characters')
        .trim()
    ];
  }

  /**
   * Business logic validation middleware
   */
  static async validateBookingBusiness(req, res, next) {
    try {
      const { course_id, course_event_id, spaces = 1 } = req.body;
      const pool = req.app.locals.pool; // Assuming pool is available

      // Validate course exists and is active
      const [courseCheck] = await pool.query(`
        SELECT id, course_name, status, dsa_fees
        FROM courses
        WHERE id = ? AND status = 1
      `, [course_id]);

      if (courseCheck.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course or course is not active'
        });
      }

      // Validate event exists, is active, and in the future
      const [eventCheck] = await pool.query(`
        SELECT 
          id, 
          event_date, 
          booking_limit, 
          bookings_done, 
          current_locks,
          (booking_limit - bookings_done - current_locks) as spaces_available
        FROM course_events
        WHERE id = ? AND status = 1 AND event_date >= CURDATE()
      `, [course_event_id]);

      if (eventCheck.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid course event, event is not active, or event is in the past'
        });
      }

      const event = eventCheck[0];

      // Check if enough spaces available
      if (event.spaces_available < spaces) {
        return res.status(400).json({
          success: false,
          message: `Insufficient spaces available. Only ${event.spaces_available} spaces remaining`
        });
      }

      // Check if event belongs to the course
      const [courseEventCheck] = await pool.query(`
        SELECT id FROM course_events
        WHERE id = ? AND course_id = ?
      `, [course_event_id, course_id]);

      if (courseEventCheck.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Course event does not belong to the specified course'
        });
      }

      // Check for existing user booking for this event
      const [existingBooking] = await pool.query(`
        SELECT id, status
        FROM bookings
        WHERE user_id = ? AND course_event_id = ? AND status IN (0, 1, 2)
      `, [req.user.id, course_event_id]);

      if (existingBooking.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'You already have an active booking for this event'
        });
      }

      // Store validated data for use in controller
      req.validatedData = {
        course: courseCheck[0],
        event: event
      };

      next();

    } catch (error) {
      console.error('Business validation error:', error);
      res.status(500).json({
        success: false,
        message: 'Validation error',
        error: error.message
      });
    }
  }

  /**
   * Validate booking ownership (for update/cancel operations)
   */
  static async validateBookingOwnership(req, res, next) {
    try {
      const { id } = req.params;
      const user_id = req.user.id;
      const pool = req.app.locals.pool;

      const [bookingCheck] = await pool.query(`
        SELECT 
          b.id, 
          b.status, 
          b.course_event_id,
          ce.event_date
        FROM bookings b
        JOIN course_events ce ON b.course_event_id = ce.id
        WHERE b.id = ? AND b.user_id = ?
      `, [id, user_id]);

      if (bookingCheck.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found or you do not have permission to access it'
        });
      }

      const booking = bookingCheck[0];

      // Store booking data for use in controller
      req.bookingData = booking;

      next();

    } catch (error) {
      console.error('Booking ownership validation error:', error);
      res.status(500).json({
        success: false,
        message: 'Validation error',
        error: error.message
      });
    }
  }

  /**
   * Validate booking can be modified
   */
  static validateBookingModifiable(req, res, next) {
    const booking = req.bookingData;

    // Check if booking is in a state that allows modification
    if (booking.status === 3) {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify a cancelled booking'
      });
    }

    if (booking.status === 2 || booking.status === 4) {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify a completed or no-show booking'
      });
    }

    // Check if event is in the past
    const eventDate = new Date(booking.event_date);
    const now = new Date();

    if (eventDate < now) {
      return res.status(400).json({
        success: false,
        message: 'Cannot modify bookings for past events'
      });
    }

    next();
  }

  /**
   * Validate booking can be cancelled
   */
  static validateBookingCancellable(req, res, next) {
    const booking = req.bookingData;

    // Check if booking is already cancelled
    if (booking.status === 3) {
      return res.status(400).json({
        success: false,
        message: 'Booking is already cancelled'
      });
    }

    // Check if booking is completed or no-show
    if (booking.status === 2 || booking.status === 4) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed or no-show bookings'
      });
    }

    // Check if event is in the past
    const eventDate = new Date(booking.event_date);
    const now = new Date();

    if (eventDate < now) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel bookings for past events'
      });
    }

    // Check cancellation policy (24 hours notice)
    const hoursUntilEvent = (eventDate - now) / (1000 * 60 * 60);
    
    if (hoursUntilEvent < 24) {
      // Allow cancellation but add warning
      req.lateCancellation = true;
      req.hoursUntilEvent = hoursUntilEvent;
    }

    next();
  }

  /**
   * Admin role validation middleware
   */
  static validateAdminRole(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    next();
  }
}

module.exports = BookingValidation;