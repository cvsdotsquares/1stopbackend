// src/controllers/bookings.js
const { validationResult } = require('express-validator');
const { formatMySQLDateToDDMMYYYY, formatDateToDDMMYYYY } = require('../utils/dateFormat');
const { sendBookingConfirmation } = require('../utils/emailService');
const { replaceTokensInObject } = require('../utils/tokenReplacer');

class BookingController {
  constructor(pool) {
    this.pool = pool;
  }

  async getBookingConfirmationPayload(connection, bookingId, userId, userEmail) {
    const [bookings] = await connection.query(`
      SELECT
        b.id,
        b.course_id,
        b.course_event_id,
        b.total_amount,
        b.payment_due,
        b.vat,
        b.total_fees,
        b.refundable,
        b.type_of_book,
        (
          SELECT ba2.booking_ref
          FROM booking_attendees ba2
          WHERE ba2.booking_id = b.id
          ORDER BY ba2.primary DESC, ba2.id ASC
          LIMIT 1
        ) AS booking_ref
      FROM bookings b
      WHERE b.id = ?
        AND (
          b.user_id = ?
          OR EXISTS (
            SELECT 1
            FROM booking_attendees ba
            WHERE ba.booking_id = b.id AND ba.email = ?
          )
        )
      LIMIT 1
    `, [bookingId, userId, userEmail]);

    if (bookings.length === 0) {
      return null;
    }

    const booking = bookings[0];

    const [attendees] = await connection.query(`
      SELECT first_name, sur_name, email, contact1, contact2, contact3, vehicle_type
      FROM booking_attendees
      WHERE booking_id = ?
      ORDER BY \`primary\` DESC, id ASC
    `, [bookingId]);

    const [courseData] = await connection.query(`
      SELECT email_content, course_name
      FROM courses
      WHERE id = ?
      LIMIT 1
    `, [booking.course_id]);

    const [locationData] = await connection.query(`
      SELECT location_name, address1, address2, address3, address4,
             postcode, direction_map, direction_content
      FROM locations
      WHERE id = (SELECT location_id FROM course_events WHERE id = ?)
      LIMIT 1
    `, [booking.course_event_id]);

    const [eventDates] = await connection.query(`
      SELECT event_date, event_start_time, event_end_time
      FROM course_event_dates
      WHERE course_event_id = ?
      ORDER BY event_date ASC, event_start_time ASC
    `, [booking.course_event_id]);

    const [franchiseData] = await connection.query(`
      SELECT f.email_header, f.email_footer, f.email_logo, f.website,
             f.telephone, f.freephone, f.franchise_email
      FROM franchise f
      JOIN course_events ce ON ce.franchise_id = f.id
      WHERE ce.id = ?
      LIMIT 1
    `, [booking.course_event_id]);

    const [settingsData] = await connection.query(`
      SELECT booking_bcc
      FROM settings
      LIMIT 1
    `);

    const computedBookingRef = booking.booking_ref || `1SRC${booking.id}`;

    return {
      course_name: courseData[0]?.course_name || 'Course',
      booking_ref: computedBookingRef,
      booking_type: booking.type_of_book || 'o',
      refundable: Number(booking.refundable || 0),
      attendees,
      location: locationData[0] || {},
      event_dates: eventDates,
      booking: {
        total_amount: booking.total_amount,
        payment_due: Math.max(0, Number(booking.payment_due || 0)),
        vat: booking.vat,
        total_fees: booking.total_fees
      },
      course_email_content: courseData[0]?.email_content || '',
      franchise: franchiseData[0] || {},
      bcc: settingsData[0]?.booking_bcc || process.env.BOOKING_BCC || '',
      ip: 'dashboard'
    };
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
        const booking_fee = Math.round(((base_amount * 0.0125) + 0.2) * 100) / 100; // 1.25% + £0.20
        const total_amount = base_amount + booking_fee;

        // 6. Create booking
        const [bookingResult] = await connection.query(`
          INSERT INTO bookings (
            user_id,
            course_id,
            course_event_id,
            spaces,
            payment_due,
            total_amount,
            admin_payment_received,
            total_fees,
            status,
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
            b.total_amount,
            b.status,
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
          b.total_amount,
          b.status,
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
      const user_email = req.user.email;

      const [bookings] = await this.pool.query(`
        SELECT
          b.id,
          b.user_id,
          b.booking_made_by_id,
          b.course_id,
          b.course_event_id,
          b.spaces,
          b.total_amount,
          b.payment_due,
          b.admin_payment_received,
          b.type_of_book,
          b.status,
          NULL as emergency_contact_name,
          NULL as emergency_contact_phone,
          NULL as special_requirements,
          b.created,
          b.modified,
          c.course_name,
          c.course_abb,
          c.description,
          c.dsa_fees,
          MIN(ced.event_date) as event_date,
          ced.event_start_time,
          l.id as location_id,
          l.location_name,
          l.address1,
          l.address2,
          l.address3,
          l.address4,
          l.postcode,
          u.first_name,
          u.sur_name,
          u.email,
          u.contact1,
          bp.transation_id as transaction_id,
          CASE
            WHEN b.status = 0 THEN 'Pending Payment'
            WHEN b.status = 1 THEN 'Confirmed'
            WHEN b.status = 2 THEN 'Completed'
            WHEN b.status = 3 THEN 'Cancelled'
            WHEN b.status = 4 THEN 'No Show'
            ELSE 'Unknown'
          END as status_text,
          CASE
            WHEN MIN(ced.event_date) > CURDATE() THEN 'upcoming'
            WHEN MIN(ced.event_date) = CURDATE() THEN 'today'
            ELSE 'past'
          END as timing_status
        FROM bookings b
        JOIN courses c ON b.course_id = c.id
        JOIN course_events ce ON b.course_event_id = ce.id
        JOIN course_event_dates ced ON ce.id = ced.course_event_id AND ced.event_date > '1900-01-01'
        JOIN locations l ON ce.location_id = l.id
        JOIN users u ON b.user_id = u.id
        LEFT JOIN booking_payments bp ON b.id = bp.booking_id AND bp.payment_type = 'SALE'
        LEFT JOIN booking_attendees ba ON b.id = ba.booking_id
        WHERE b.id = ? AND (b.user_id = ? OR ba.email = ?)
        GROUP BY b.id, b.user_id, b.booking_made_by_id, b.course_id, b.course_event_id, b.spaces, b.total_amount, b.payment_due,
                 b.admin_payment_received, b.type_of_book, b.status,
                 b.created, b.modified, c.course_name, c.course_abb, c.description, c.dsa_fees,
                 ced.event_start_time, l.id, l.location_name, l.address1, l.address2, l.address3, l.address4, l.postcode,
                 u.first_name, u.sur_name, u.email, u.contact1, bp.transation_id
      `, [id, user_id, user_email]);

      if (bookings.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Fetch all attendees for this booking
      const [attendees] = await this.pool.query(`
        SELECT id, first_name, sur_name, email, vehicle_type, \`primary\`
        FROM booking_attendees
        WHERE booking_id = ?
        ORDER BY \`primary\` DESC, id ASC
      `, [id]);

      // Fetch secondary attendees (same course_event_id + booking_made_by_id group, excluding primary user)
      const primaryUserId = bookings[0].booking_made_by_id || bookings[0].user_id;
      const [secondaryAttendees] = await this.pool.query(`
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
      `, [bookings[0].course_event_id, primaryUserId, primaryUserId, id]);

      const processedData = await replaceTokensInObject(this.pool, {
        ...bookings[0],
        attendees,
        secondary_attendees: secondaryAttendees
      });

      res.json({
        success: true,
        data: {
          ...processedData
        }
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

  async getBookingConfirmationPreview(req, res) {
    const connection = await this.pool.getConnection();
    try {
      const bookingId = Number.parseInt(req.params.id, 10);
      const userId = req.user.id;
      const userEmail = req.user.email;

      const payload = await this.getBookingConfirmationPayload(connection, bookingId, userId, userEmail);
      if (!payload) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      const previewEmail = String(userEmail || payload.attendees?.[0]?.email || '').trim();
      if (!previewEmail) {
        return res.status(400).json({
          success: false,
          message: 'No email available for preview'
        });
      }

      const previewResult = await sendBookingConfirmation({
        ...payload,
        targetEmails: [previewEmail],
        previewOnly: true,
        bookingRefSuffix: 'R',
        disableBcc: true
      }, this.pool);

      const firstPreview = previewResult?.previews?.[0] || null;

      return res.json({
        success: true,
        data: {
          subject: previewResult?.subject || `${payload.course_name} Booking confirmation`,
          to: firstPreview?.to || previewEmail,
          html: firstPreview?.html || ''
        }
      });
    } catch (error) {
      console.error('Error fetching booking confirmation preview:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch booking confirmation preview',
        error: error.message
      });
    } finally {
      connection.release();
    }
  }

  async sendBookingConfirmationEmail(req, res) {
    const connection = await this.pool.getConnection();
    try {
      const bookingId = Number.parseInt(req.params.id, 10);
      const userId = req.user.id;
      const userEmail = req.user.email;
      const forwardEmail = String(req.body?.email || '').trim();

      if (forwardEmail && !/^\S+@\S+\.\S+$/.test(forwardEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address'
        });
      }

      const payload = await this.getBookingConfirmationPayload(connection, bookingId, userId, userEmail);
      if (!payload) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      const targetEmail = forwardEmail || String(userEmail || '').trim();
      if (!targetEmail) {
        return res.status(400).json({
          success: false,
          message: 'No recipient email available'
        });
      }

      const resolvedClientIp = String(
        req.clientIp || req.ip || req.headers['x-forwarded-for'] || ''
      )
        .split(',')[0]
        .replace(/^::ffff:/, '')
        .trim();

      await sendBookingConfirmation({
        ...payload,
        targetEmails: [targetEmail],
        previewOnly: false,
        ip: resolvedClientIp,
        bookingRefSuffix: 'R',
        disableBcc: true,
        logType: forwardEmail
          ? 'Booking Mail (Resend - Forward)'
          : 'Booking Mail (Resend)',
        emailBy: userId || 0
      }, this.pool);

      return res.json({
        success: true,
        message: forwardEmail
          ? `Booking confirmation forwarded to ${targetEmail}`
          : `Booking confirmation sent to ${targetEmail}`
      });
    } catch (error) {
      console.error('Error sending booking confirmation email:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send booking confirmation email',
        error: error.message
      });
    } finally {
      connection.release();
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
          emergency_contact_name = ?,
          emergency_contact_phone = ?,
          special_requirements = ?,
          modified = NOW()
        WHERE id = ?
      `, [
        emergency_contact_name || '',
        emergency_contact_phone || '',
        special_requirements || '',
        id
      ]);

      // Get updated booking
      const [updatedBooking] = await this.pool.query(`
        SELECT
          b.id,
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

        if (hoursUntilEvent < 24) {
          // Still allow cancellation but note it's late
          console.log(`Late cancellation: ${hoursUntilEvent} hours until event`);
        }

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
          u.contact1,
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