// src/controllers/bookings.js
const { validationResult } = require('express-validator');
const { formatMySQLDateToDDMMYYYY, formatDateToDDMMYYYY } = require('../utils/dateFormat');
class BookingController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Create a new booking
   */
  async createBooking(req, res) {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const {
        course_id,
        course_event_id,
        spaces = 1,
        customer_notes = '',
        emergency_contact_name = '',
        emergency_contact_phone = '',
        special_requirements = ''
      } = req.body;

      const user_id = req.user.id;

      // Start transaction
      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        // 1. Verify course and event exist
        const [courseCheck] = await connection.query(`
          SELECT c.id, c.course_name, c.dsa_fees, c.status as course_status
          FROM courses c
          WHERE c.id = ? AND c.status = 1
        `, [course_id]);

        if (courseCheck.length === 0) {
          throw new Error('Course not found or inactive');
        }

        const course = courseCheck[0];

        // 2. Verify event exists and has availability
        const [eventCheck] = await connection.query(`
          SELECT
            ce.id,
            ce.event_date,
            ce.booking_limit,
            ce.bookings_done,
            ce.current_locks,
            (ce.booking_limit - ce.bookings_done - ce.current_locks) as spaces_available,
            ce.status as event_status,
            l.location_name,
            l.address as location_address
          FROM course_events ce
          JOIN locations l ON ce.location_id = l.id
          WHERE ce.id = ? AND ce.status = 1 AND ce.event_date >= CURDATE()
        `, [course_event_id]);

        if (eventCheck.length === 0) {
          throw new Error('Course event not found, inactive, or in the past');
        }

        const event = eventCheck[0];

        // 3. Check availability
        if (event.spaces_available < spaces) {
          throw new Error(`Insufficient spaces available. Only ${event.spaces_available} spaces remaining`);
        }

        // 4. Check for existing user bookings for this event
        const [existingBooking] = await connection.query(`
          SELECT id, status
          FROM bookings
          WHERE user_id = ? AND course_event_id = ? AND status IN (0, 1, 2)
        `, [user_id, course_event_id]);

        if (existingBooking.length > 0) {
          throw new Error('You already have a booking for this event');
        }

        // 5. Calculate total amount
        const base_amount = course.dsa_fees * spaces;
        const booking_fee = Math.round(base_amount * 0.025); // 2.5% booking fee
        const total_amount = base_amount + booking_fee;

        // 6. Create booking
        const [bookingResult] = await connection.query(`
          INSERT INTO bookings (
            user_id,
            course_id,
            course_event_id,
            spaces,
            base_amount,
            booking_fee,
            total_amount,
            status,
            customer_notes,
            emergency_contact_name,
            emergency_contact_phone,
            special_requirements,
            created,
            modified
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NOW(), NOW())
        `, [
          user_id,
          course_id,
          course_event_id,
          spaces,
          base_amount,
          booking_fee,
          total_amount,
          customer_notes,
          emergency_contact_name,
          emergency_contact_phone,
          special_requirements
        ]);

        const booking_id = bookingResult.insertId;

        // 7. Update event locks (temporary hold)
        await connection.query(`
          UPDATE course_events
          SET current_locks = current_locks + ?, modified = NOW()
          WHERE id = ?
        `, [spaces, course_event_id]);

        // 8. Get complete booking data
        const [newBooking] = await connection.query(`
          SELECT
            b.id,
            b.user_id,
            b.course_id,
            b.course_event_id,
            b.spaces,
            b.base_amount,
            b.booking_fee,
            b.total_amount,
            b.status,
            b.customer_notes,
            b.emergency_contact_name,
            b.emergency_contact_phone,
            b.special_requirements,
            b.created,
            b.modified,
            c.course_name,
            c.course_abb,
            ce.event_date,
            l.location_name,
            l.address as location_address,
            CASE
              WHEN b.status = 0 THEN 'Pending Payment'
              WHEN b.status = 1 THEN 'Confirmed'
              WHEN b.status = 2 THEN 'Completed'
              WHEN b.status = 3 THEN 'Cancelled'
              WHEN b.status = 4 THEN 'No Show'
              ELSE 'Unknown'
            END as status_text
          FROM bookings b
          JOIN courses c ON b.course_id = c.id
          JOIN course_events ce ON b.course_event_id = ce.id
          JOIN locations l ON ce.location_id = l.id
          WHERE b.id = ?
        `, [booking_id]);

        await connection.commit();

        res.status(201).json({
          success: true,
          message: 'Booking created successfully',
          data: newBooking[0]
        });

      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

    } catch (error) {
      console.error('Error creating booking:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to create booking',
        error: error.message
      });
    }
  }

  /**
   * Get course availability for booking calendar
   */
  async getCourseAvailability(req, res) {
    try {
      const { course_id, location_id, start_date, weeks = 6 } = req.query;

      if (!course_id || !location_id) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Course ID and Location ID are required',
            details: {
              course_id: !course_id ? ['Course ID is required'] : [],
              location_id: !location_id ? ['Location ID is required'] : []
            }
          }
        });
      }

      const startDate = start_date || new Date().toISOString().split('T')[0];
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + (weeks * 7));

      // Get course events with availability
      const [availability] = await this.pool.query(`
        SELECT
          ced.event_date as date,
          ced.event_start_time,
          ced.event_end_time,
          ced.freeze,
          ce.id as course_event_id,
          ce.booking_limit,
          ce.bookings_done,
          ce.current_locks,
          (ce.booking_limit - ce.bookings_done - ce.current_locks) as available_spaces
        FROM course_events ce
        JOIN course_event_dates ced ON ce.id = ced.course_event_id
        WHERE ce.course_id = ?
          AND ce.location_id = ?
          AND ce.status = '1'
          AND ced.event_date >= ?
          AND ced.event_date <= ?
          AND ced.event_date != '1111-11-11'
          AND ced.freeze != 1
        ORDER BY ced.event_date ASC
      `, [course_id, location_id, startDate, endDate.toISOString().split('T')[0]]);

      const formattedAvailability = availability.map(item => ({
        date: item.date,
        available: item.available_spaces > 0,
        available_spaces: item.available_spaces,
        booking_limit: item.booking_limit,
        bookings_done: item.bookings_done,
        current_locks: item.current_locks,
        event_start_time: item.event_start_time,
        event_end_time: item.event_end_time,
        course_event_id: item.course_event_id,
        freeze: item.freeze
      }));

      res.json({
        success: true,
        data: {
          course_id: parseInt(course_id),
          location_id: parseInt(location_id),
          availability: formattedAvailability
        }
      });

    } catch (error) {
      console.error('Error fetching course availability:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to fetch course availability',
          details: error.message
        }
      });
    }
  }

  /**
   * Create booking lock (temporary hold)
   */
  async createBookingLock(req, res) {
    try {
      const { course_event_id, spaces_required = 1, user_session } = req.body;

      if (!course_event_id) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Course event ID is required'
          }
        });
      }

      // Check if event has availability
      const [eventCheck] = await this.pool.query(`
        SELECT
          ce.booking_limit,
          ce.bookings_done,
          ce.current_locks,
          (ce.booking_limit - ce.bookings_done - ce.current_locks) as available_spaces
        FROM course_events ce
        WHERE ce.id = ? AND ce.status = '1'
      `, [course_event_id]);

      if (eventCheck.length === 0) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Course event not found'
          }
        });
      }

      const event = eventCheck[0];
      if (event.available_spaces < spaces_required) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_SPACES',
            message: `Only ${event.available_spaces} spaces available`
          }
        });
      }

      // Create lock (expires in 15 minutes)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      const [lockResult] = await this.pool.query(`
        INSERT INTO lock_bookings (
          event_id, space_required, user_id, ip_address,
          created, modified
        ) VALUES (?, ?, ?, ?, NOW(), NOW())
      `, [
        course_event_id,
        spaces_required,
        req.user?.id || 0,
        req.clientIp || req.ip
      ]);

      // Update current locks
      await this.pool.query(`
        UPDATE course_events
        SET current_locks = current_locks + ?
        WHERE id = ?
      `, [spaces_required, course_event_id]);

      res.json({
        success: true,
        data: {
          lock_id: lockResult.insertId,
          expires_at: expiresAt.toISOString()
        }
      });

    } catch (error) {
      console.error('Error creating booking lock:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Failed to create booking lock'
        }
      });
    }
  }
  async getUserBookings(req, res) {
    try {
      const user_id = req.user.id;
      const {
        status,
        page = 1,
        limit = 10,
        sort = 'created',
        order = 'DESC'
      } = req.query;

      const offset = (page - 1) * limit;

      // Build query conditions
      let whereClause = 'WHERE b.user_id = ?';
      let queryParams = [user_id];

      if (status && status !== 'all') {
        whereClause += ' AND b.status = ?';
        queryParams.push(parseInt(status));
      }

      // Valid sort fields
      const validSorts = ['created', 'modified', 'event_date', 'total_amount'];
      const sortField = validSorts.includes(sort) ? sort : 'created';
      const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      // Get bookings with pagination
      const [bookings] = await this.pool.query(`
        SELECT DISTINCT
          b.id,
          b.course_id,
          b.course_event_id,
          b.spaces,
          b.base_amount,
          b.booking_fee,
          b.total_amount,
          b.status,
          b.customer_notes,
          b.emergency_contact_name,
          b.emergency_contact_phone,
          b.special_requirements,
          b.created,
          b.modified,
          c.course_name,
          c.course_abb,
          c.description,
          ce.event_date,
          ce.event_time,
          l.id as location_id,
          l.location_name,
          l.address as location_address,
          l.post_code,
          l.phone as location_phone,
          CASE
            WHEN b.status = 0 THEN 'Pending Payment'
            WHEN b.status = 1 THEN 'Confirmed'
            WHEN b.status = 2 THEN 'Completed'
            WHEN b.status = 3 THEN 'Cancelled'
            WHEN b.status = 4 THEN 'No Show'
            ELSE 'Unknown'
          END as status_text,
          CASE
            WHEN ce.event_date > CURDATE() THEN 'upcoming'
            WHEN ce.event_date = CURDATE() THEN 'today'
            ELSE 'past'
          END as timing_status
        FROM bookings b
        JOIN courses c ON b.course_id = c.id
        JOIN course_events ce ON b.course_event_id = ce.id
        JOIN locations l ON ce.location_id = l.id
        LEFT JOIN booking_attendees ba ON b.id = ba.booking_id
        ${whereClause} AND (b.user_id = ? OR ba.email = ?)
        ORDER BY ${sortField === 'event_date' ? 'ce.event_date' : 'b.' + sortField} ${sortOrder}
        LIMIT ? OFFSET ?
      `, [...queryParams, user_id, req.user.email, parseInt(limit), offset]);

      // Get total count for pagination
      const [countResult] = await this.pool.query(`
        SELECT COUNT(DISTINCT b.id) as total
        FROM bookings b
        LEFT JOIN booking_attendees ba ON b.id = ba.booking_id
        ${whereClause} AND (b.user_id = ? OR ba.email = ?)
      `, [...queryParams, user_id, req.user.email]);

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      // Format dates to DD/MM/YYYY
      const formattedBookings = bookings.map(booking => ({
        ...booking,
        event_date: formatMySQLDateToDDMMYYYY(booking.event_date),
        created: formatDateToDDMMYYYY(booking.created),
        modified: formatDateToDDMMYYYY(booking.modified)
      }));

      res.json({
        success: true,
        data: formattedBookings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });

    } catch (error) {
      console.error('Error fetching user bookings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bookings',
        error: error.message
      });
    }
  }

  /**
   * Get booking by ID
   */
  async getBookingById(req, res) {
    try {
      const { id } = req.params;
      const user_id = req.user.id;

      const [bookings] = await this.pool.query(`
        SELECT
          b.id,
          b.user_id,
          b.course_id,
          b.course_event_id,
          b.spaces,
          b.base_amount,
          b.booking_fee,
          b.total_amount,
          b.status,
          b.customer_notes,
          b.emergency_contact_name,
          b.emergency_contact_phone,
          b.special_requirements,
          b.created,
          b.modified,
          c.course_name,
          c.course_abb,
          c.description,
          c.dsa_fees,
          ce.event_date,
          ce.event_time,
          l.id as location_id,
          l.location_name,
          l.address as location_address,
          l.post_code,
          l.phone as location_phone,
          l.email as location_email,
          u.first_name,
          u.sur_name,
          u.email,
          u.mobile,
          CASE
            WHEN b.status = 0 THEN 'Pending Payment'
            WHEN b.status = 1 THEN 'Confirmed'
            WHEN b.status = 2 THEN 'Completed'
            WHEN b.status = 3 THEN 'Cancelled'
            WHEN b.status = 4 THEN 'No Show'
            ELSE 'Unknown'
          END as status_text,
          CASE
            WHEN ce.event_date > CURDATE() THEN 'upcoming'
            WHEN ce.event_date = CURDATE() THEN 'today'
            ELSE 'past'
          END as timing_status
        FROM bookings b
        JOIN courses c ON b.course_id = c.id
        JOIN course_events ce ON b.course_event_id = ce.id
        JOIN locations l ON ce.location_id = l.id
        JOIN users u ON b.user_id = u.id
        WHERE b.id = ? AND b.user_id = ?
      `, [id, user_id]);

      if (bookings.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      res.json({
        success: true,
        data: bookings[0]
      });

    } catch (error) {
      console.error('Error fetching booking:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch booking',
        error: error.message
      });
    }
  }

  /**
   * Update booking details
   */
  async updateBooking(req, res) {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array()
        });
      }

      const { id } = req.params;
      const user_id = req.user.id;
      const {
        customer_notes,
        emergency_contact_name,
        emergency_contact_phone,
        special_requirements
      } = req.body;

      // Check if booking exists and belongs to user
      const [existingBooking] = await this.pool.query(`
        SELECT id, status, course_event_id
        FROM bookings
        WHERE id = ? AND user_id = ?
      `, [id, user_id]);

      if (existingBooking.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      const booking = existingBooking[0];

      // Only allow updates for pending or confirmed bookings
      if (booking.status === 3 || booking.status === 4) {
        return res.status(400).json({
          success: false,
          message: 'Cannot update cancelled or no-show bookings'
        });
      }

      // Check if event is in the past
      const [eventCheck] = await this.pool.query(`
        SELECT event_date FROM course_events WHERE id = ?
      `, [booking.course_event_id]);

      if (eventCheck[0].event_date < new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Cannot update bookings for past events'
        });
      }

      // Update booking
      await this.pool.query(`
        UPDATE bookings
        SET
          customer_notes = ?,
          emergency_contact_name = ?,
          emergency_contact_phone = ?,
          special_requirements = ?,
          modified = NOW()
        WHERE id = ?
      `, [
        customer_notes || '',
        emergency_contact_name || '',
        emergency_contact_phone || '',
        special_requirements || '',
        id
      ]);

      // Get updated booking
      const [updatedBooking] = await this.pool.query(`
        SELECT
          b.id,
          b.customer_notes,
          b.emergency_contact_name,
          b.emergency_contact_phone,
          b.special_requirements,
          b.modified
        FROM bookings b
        WHERE b.id = ?
      `, [id]);

      res.json({
        success: true,
        message: 'Booking updated successfully',
        data: updatedBooking[0]
      });

    } catch (error) {
      console.error('Error updating booking:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update booking',
        error: error.message
      });
    }
  }

  /**
   * Cancel booking
   */
  async cancelBooking(req, res) {
    try {
      const { id } = req.params;
      const user_id = req.user.id;
      const { cancellation_reason } = req.body;

      // Start transaction
      const connection = await this.pool.getConnection();
      await connection.beginTransaction();

      try {
        // Get booking details
        const [bookingCheck] = await connection.query(`
          SELECT
            b.id,
            b.status,
            b.spaces,
            b.course_event_id,
            ce.event_date
          FROM bookings b
          JOIN course_events ce ON b.course_event_id = ce.id
          WHERE b.id = ? AND b.user_id = ?
        `, [id, user_id]);

        if (bookingCheck.length === 0) {
          throw new Error('Booking not found');
        }

        const booking = bookingCheck[0];

        // Check if booking can be cancelled
        if (booking.status === 3) {
          throw new Error('Booking is already cancelled');
        }

        if (booking.status === 2 || booking.status === 4) {
          throw new Error('Cannot cancel completed or no-show bookings');
        }

        // Check cancellation policy (e.g., must cancel at least 24 hours before)
        const eventDate = new Date(booking.event_date);
        const now = new Date();
        const hoursUntilEvent = (eventDate - now) / (1000 * 60 * 60);

        // Update booking status to cancelled
        await connection.query(`
          UPDATE bookings
          SET
            status = 3,
            modified = NOW()
          WHERE id = ?
        `, [id]);

        // Release the spaces back to the event
        if (booking.status === 0) {
          // If it was pending, release from locks
          await connection.query(`
            UPDATE course_events
            SET current_locks = GREATEST(0, current_locks - ?)
            WHERE id = ?
          `, [booking.spaces, booking.course_event_id]);
        } else if (booking.status === 1) {
          // If it was confirmed, release from bookings_done
          await connection.query(`
            UPDATE course_events
            SET bookings_done = GREATEST(0, bookings_done - ?)
            WHERE id = ?
          `, [booking.spaces, booking.course_event_id]);
        }

        await connection.commit();

        res.json({
          success: true,
          message: 'Booking cancelled successfully'
        });

      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

    } catch (error) {
      console.error('Error cancelling booking:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to cancel booking',
        error: error.message
      });
    }
  }

  /**
   * Get booking statistics for user
   */
  async getBookingStats(req, res) {
    try {
      const user_id = req.user.id;

      const [stats] = await this.pool.query(`
        SELECT
          COUNT(*) as total_bookings,
          COUNT(CASE WHEN status = 0 THEN 1 END) as pending_bookings,
          COUNT(CASE WHEN status = 1 THEN 1 END) as confirmed_bookings,
          COUNT(CASE WHEN status = 2 THEN 1 END) as completed_bookings,
          COUNT(CASE WHEN status = 3 THEN 1 END) as cancelled_bookings,
          COUNT(CASE WHEN status = 4 THEN 1 END) as noshow_bookings,
          SUM(total_amount) as total_spent,
          AVG(total_amount) as average_booking_value,
          MAX(created) as last_booking_date
        FROM bookings
        WHERE user_id = ?
      `, [user_id]);

      // Get upcoming bookings count
      const [upcomingStats] = await this.pool.query(`
        SELECT COUNT(*) as upcoming_bookings
        FROM bookings b
        JOIN course_events ce ON b.course_event_id = ce.id
        WHERE b.user_id = ?
          AND b.status IN (0, 1)
          AND ce.event_date >= CURDATE()
      `, [user_id]);

      res.json({
        success: true,
        data: {
          ...stats[0],
          upcoming_bookings: upcomingStats[0].upcoming_bookings
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

  /**
   * Admin: Get all bookings (protected route for admin)
   */
  async getAllBookings(req, res) {
    try {
      const {
        status,
        course_id,
        location_id,
        date_from,
        date_to,
        page = 1,
        limit = 20,
        search
      } = req.query;

      const offset = (page - 1) * limit;

      // Build query conditions
      let whereClause = 'WHERE 1=1';
      let queryParams = [];

      if (status && status !== 'all') {
        whereClause += ' AND b.status = ?';
        queryParams.push(parseInt(status));
      }

      if (course_id) {
        whereClause += ' AND b.course_id = ?';
        queryParams.push(course_id);
      }

      if (location_id) {
        whereClause += ' AND ce.location_id = ?';
        queryParams.push(location_id);
      }

      if (date_from) {
        whereClause += ' AND ce.event_date >= ?';
        queryParams.push(date_from);
      }

      if (date_to) {
        whereClause += ' AND ce.event_date <= ?';
        queryParams.push(date_to);
      }

      if (search) {
        whereClause += ' AND (u.first_name LIKE ? OR u.sur_name LIKE ? OR u.email LIKE ? OR c.course_name LIKE ?)';
        const searchPattern = `%${search}%`;
        queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
      }

      // Get bookings with pagination
      const [bookings] = await this.pool.query(`
        SELECT
          b.id,
          b.user_id,
          b.course_id,
          b.course_event_id,
          b.spaces,
          b.total_amount,
          b.status,
          b.created,
          b.modified,
          c.course_name,
          c.course_abb,
          ce.event_date,
          ce.event_time,
          l.location_name,
          u.first_name,
          u.sur_name,
          u.email,
          u.mobile,
          CASE
            WHEN b.status = 0 THEN 'Pending Payment'
            WHEN b.status = 1 THEN 'Confirmed'
            WHEN b.status = 2 THEN 'Completed'
            WHEN b.status = 3 THEN 'Cancelled'
            WHEN b.status = 4 THEN 'No Show'
            ELSE 'Unknown'
          END as status_text
        FROM bookings b
        JOIN courses c ON b.course_id = c.id
        JOIN course_events ce ON b.course_event_id = ce.id
        JOIN locations l ON ce.location_id = l.id
        JOIN users u ON b.user_id = u.id
        ${whereClause}
        ORDER BY b.created DESC
        LIMIT ? OFFSET ?
      `, [...queryParams, parseInt(limit), offset]);

      // Get total count
      const [countResult] = await this.pool.query(`
        SELECT COUNT(*) as total
        FROM bookings b
        JOIN course_events ce ON b.course_event_id = ce.id
        JOIN users u ON b.user_id = u.id
        JOIN courses c ON b.course_id = c.id
        ${whereClause}
      `, queryParams);

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      res.json({
        success: true,
        data: bookings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });

    } catch (error) {
      console.error('Error fetching all bookings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch bookings',
        error: error.message
      });
    }
  }
}

module.exports = BookingController;